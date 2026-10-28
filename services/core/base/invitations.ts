import { z } from "zod";
import { endpoints, InvitationSchema, InstantSchema, IdSchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { CoreProjects } from "./projects";
import { actor, etag, replay } from "./http";
import { compare, fail, newId } from "./store";
import { invitation, accessEvent, addMember, queueInvitation, secretToken, hashToken } from "./access-records";
import { saveHttp } from "./receipts";

export function registerInvitations(context: ModuleContext, service: CoreProjects): void {
  context.routes.register(endpoints.invitationCreate, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `invitationCreate:${input.params.p}`, body: input.body, schema: InvitationSchema }, async (http) => {
      const project = (await service.getProject(input.params.p));
      await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
      compare(project.version, input.body.expectedVersion);
      const user = (await context.db.get<{ id: string }>("SELECT user_id AS id FROM verified_emails WHERE lower(email)=lower(?)", [input.body.email]));
      await service.checkSharing(actorId, project.id, user ? IdSchema.parse(user.id) : undefined);
      await service.checkCapacity(actorId, project.id, { role: input.body.role,
        ...(user ? { userId: IdSchema.parse(user.id) } : {}) });
      if ((await context.db.get("SELECT 1 FROM invitations WHERE project_id=? AND lower(email)=lower(?) AND status='pending'", [project.id, input.body.email]))) fail("INVITATION_PENDING", 409, "Invitation is already pending");
      const id = newId();
      const token = secretToken();
      const tokenHash = hashToken(token);
      const expires = InstantSchema.parse(new Date(Date.parse(context.clock.now()) + 7 * 86400000).toISOString());
      (await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        const boundContext = { ...context, db: tx };
        const boundService = new CoreProjects(boundContext);

        await boundService.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
        compare((await boundService.getProject(project.id)).version, input.body.expectedVersion);
        await boundService.checkSharing(actorId, project.id, user ? IdSchema.parse(user.id) : undefined);
        await boundService.checkCapacity(actorId, project.id, { role: input.body.role,
          ...(user ? { userId: IdSchema.parse(user.id) } : {}) });
        if (await tx.get("SELECT 1 FROM invitations WHERE project_id=? AND lower(email)=lower(?) AND status='pending'",
          [project.id, input.body.email])) fail("INVITATION_PENDING", 409, "Invitation is already pending");
        (await tx.run(`INSERT INTO invitations(id,project_id,email,role,token_hash,expires_at,created_at)
          VALUES(?,?,?,?,?,?,?)`, [id, project.id, input.body.email.toLowerCase(), input.body.role, tokenHash, expires, boundContext.clock.now()]));
        (await queueInvitation(boundService, { id, token, email: input.body.email, version: 0 }, tx));
        await saveHttp(boundContext, http, await invitation(boundService, id), 0);
        (await accessEvent(boundService, project.id, tx));

      }));
      (await context.events.dispatch()); etag(request, 0); return (await invitation(service, id));
    });
  });
  context.routes.register(endpoints.invitationAccept, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `invitationAccept:${input.params.id}`, body: input.body, schema: endpoints.invitationAccept.output }, async (http) => {
      const item = (await invitation(service, input.params.id));
      compare(item.version, input.body.expectedVersion);
      const row = (await service.one("SELECT token_hash FROM invitations WHERE id=?", [item.id], z.object({ token_hash: z.string() })));
      if (item.status !== "pending" || Date.parse(item.expiresAt) <= Date.parse(context.clock.now())
        || row.token_hash !== hashToken(input.body.token)) fail("INVALID_INVITATION", 403, "Invitation is invalid or expired");
      if (!(await service.readUser(actorId)).verifiedEmails.some((email) => email.toLowerCase() === item.email.toLowerCase())) {
        fail("INVITATION_EMAIL", 403, "Invitation requires a matching verified email");
      }
      if (!item.projectId) fail("NOT_FOUND", 404, "Project invitation not found");
      const project = (await service.getProject(item.projectId));
      if (project.ownerId === actorId) fail("ALREADY_OWNER", 409, "Owner cannot accept collaborator access");
      await service.checkSharing(project.ownerId, project.id, actorId);
      await service.checkCapacity(project.ownerId, project.id, { role: item.role, userId: actorId });
      (await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        const boundContext = { ...context, db: tx };
        const boundService = new CoreProjects(boundContext);

        const current = await invitation(boundService, item.id);
        compare(current.version, input.body.expectedVersion);
        if (current.status !== "pending" || current.expiresAt <= context.clock.now()) fail("INVALID_INVITATION", 403, "Invitation is invalid or expired");
        if (!(await boundService.readUser(actorId)).verifiedEmails.some(email => email.toLowerCase() === item.email.toLowerCase())) {
          fail("INVITATION_EMAIL", 403, "Invitation requires a matching verified email");
        }
        const currentProject = await boundService.getProject(project.id);
        if (currentProject.ownerId === actorId) fail("ALREADY_OWNER", 409, "Owner cannot accept collaborator access");
        await boundService.checkSharing(currentProject.ownerId, project.id, actorId);
        await boundService.checkCapacity(currentProject.ownerId, project.id, { role: item.role, userId: actorId });
        (await addMember(boundService, { projectId: project.id, userId: actorId, role: item.role }, tx));
        (await tx.run("UPDATE invitations SET status='accepted',version=version+1 WHERE id=?", [item.id]));
        await saveHttp(boundContext, http, { ok: true, version: item.version + 1 }, item.version + 1);
        (await accessEvent(boundService, project.id, tx));

      }));
      (await context.events.dispatch()); etag(request, item.version + 1); return { ok: true, version: item.version + 1 };
    });
  });
  context.routes.register(endpoints.invitationResend, async (input, request) => {
    const actorId = await actor(context, request);
    const project = (await service.getProject(input.params.p));
    await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
    const item = (await invitation(service, input.params.id));
    if (item.projectId !== project.id) fail("NOT_FOUND", 404, "Invitation not found");
    compare(item.version, input.body.expectedVersion);
    if (item.status !== "pending") fail("INVITATION_CLOSED", 409, "Only pending invitations can be resent");
    const token = secretToken();
    const tokenHash = hashToken(token);
    const expires = InstantSchema.parse(new Date(Date.parse(context.clock.now()) + 7 * 86400000).toISOString());
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const boundContext = { ...context, db: tx };
      const boundService = new CoreProjects(boundContext);

      await boundService.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
      compare((await invitation(boundService, item.id)).version, input.body.expectedVersion);
      (await tx.run("UPDATE invitations SET token_hash=?,expires_at=?,version=version+1 WHERE id=?", [tokenHash, expires, item.id]));
      (await queueInvitation(boundService, { id: item.id, token, email: item.email, version: item.version + 1 }, tx));
      (await accessEvent(boundService, project.id, tx));

    }));
    (await context.events.dispatch()); etag(request, item.version + 1); return (await invitation(service, item.id));
  });
  context.routes.register(endpoints.invitationDelete, async (input, request) => {
    const actorId = await actor(context, request);
    const project = (await service.getProject(input.params.p));
    await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
    const item = (await invitation(service, input.params.id));
    if (item.projectId !== project.id) fail("NOT_FOUND", 404, "Invitation not found");
    compare(item.version, input.body.expectedVersion);
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const boundContext = { ...context, db: tx };
      const boundService = new CoreProjects(boundContext);

      await boundService.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
      compare((await invitation(boundService, item.id)).version, input.body.expectedVersion);
      (await tx.run("UPDATE invitations SET status='revoked',version=version+1 WHERE id=?", [item.id]));
      (await accessEvent(boundService, project.id, tx));

    }));
    (await context.events.dispatch()); return { ok: true as const, version: item.version + 1 };
  });
}
