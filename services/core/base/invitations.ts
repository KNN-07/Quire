import { z } from "zod";
import { endpoints, InvitationSchema, InstantSchema, IdSchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { actor, etag, replay } from "./http";
import { compare, fail, newId } from "./store";
import { invitation, accessEvent, addMember, queueInvitation, secretToken, hashToken } from "./access-records";

export function registerInvitations(context: ModuleContext, service: CoreProjects): void {
  context.routes.register(endpoints.invitationCreate, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `invitationCreate:${input.params.p}`, body: input.body, schema: InvitationSchema }, async () => {
      const project = service.getProject(input.params.p);
      await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
      compare(project.version, input.body.expectedVersion);
      const user = context.db.query<{ id: string }, [string]>("SELECT user_id AS id FROM verified_emails WHERE email=? COLLATE NOCASE").get(input.body.email);
      await service.checkSharing(actorId, project.id, user ? IdSchema.parse(user.id) : undefined);
      await service.checkCapacity(actorId, project.id, input.body.role);
      if (context.db.query("SELECT 1 FROM invitations WHERE project_id=? AND email=? COLLATE NOCASE AND status='pending'")
        .get(project.id, input.body.email)) fail("INVITATION_PENDING", 409, "Invitation is already pending");
      const id = newId();
      const token = secretToken();
      const expires = InstantSchema.parse(new Date(Date.parse(context.clock.now()) + 7 * 86400000).toISOString());
      context.uow.local((tx) => {
        tx.query(`INSERT INTO invitations(id,project_id,email,role,token_hash,expires_at,created_at)
          VALUES(?,?,?,?,?,?,?)`).run(id, project.id, input.body.email.toLowerCase(), input.body.role, hashToken(token), expires, context.clock.now());
        queueInvitation(service, { id, token, email: input.body.email, version: 0 }); accessEvent(service, project.id);
      });
      context.events.dispatch(); etag(request, 0); return invitation(service, id);
    });
  });
  context.routes.register(endpoints.invitationAccept, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `invitationAccept:${input.params.id}`, body: input.body, schema: endpoints.invitationAccept.output }, async () => {
      const item = invitation(service, input.params.id);
      compare(item.version, input.body.expectedVersion);
      const row = service.one("SELECT token_hash FROM invitations WHERE id=?", [item.id], z.object({ token_hash: z.string() }));
      if (item.status !== "pending" || Date.parse(item.expiresAt) <= Date.parse(context.clock.now())
        || row.token_hash !== hashToken(input.body.token)) fail("INVALID_INVITATION", 403, "Invitation is invalid or expired");
      if (!service.readUser(actorId).verifiedEmails.some((email) => email.toLowerCase() === item.email.toLowerCase())) {
        fail("INVITATION_EMAIL", 403, "Invitation requires a matching verified email");
      }
      if (!item.projectId) fail("NOT_FOUND", 404, "Project invitation not found");
      const project = service.getProject(item.projectId);
      if (project.ownerId === actorId) fail("ALREADY_OWNER", 409, "Owner cannot accept collaborator access");
      await service.checkSharing(project.ownerId, project.id, actorId);
      await service.checkCapacity(project.ownerId, project.id, item.role);
      context.uow.local((tx) => {
        addMember(service, { projectId: project.id, userId: actorId, role: item.role });
        tx.query("UPDATE invitations SET status='accepted',version=version+1 WHERE id=?").run(item.id);
        accessEvent(service, project.id);
      });
      context.events.dispatch(); etag(request, item.version + 1); return { ok: true, version: item.version + 1 };
    });
  });
  context.routes.register(endpoints.invitationResend, async (input, request) => {
    const actorId = await actor(context, request);
    const project = service.getProject(input.params.p);
    await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
    const item = invitation(service, input.params.id);
    if (item.projectId !== project.id) fail("NOT_FOUND", 404, "Invitation not found");
    compare(item.version, input.body.expectedVersion);
    if (item.status !== "pending") fail("INVITATION_CLOSED", 409, "Only pending invitations can be resent");
    const token = secretToken();
    const expires = InstantSchema.parse(new Date(Date.parse(context.clock.now()) + 7 * 86400000).toISOString());
    context.uow.local((tx) => {
      tx.query("UPDATE invitations SET token_hash=?,expires_at=?,version=version+1 WHERE id=?").run(hashToken(token), expires, item.id);
      queueInvitation(service, { id: item.id, token, email: item.email, version: item.version + 1 });
      accessEvent(service, project.id);
    });
    context.events.dispatch(); etag(request, item.version + 1); return invitation(service, item.id);
  });
  context.routes.register(endpoints.invitationDelete, async (input, request) => {
    const actorId = await actor(context, request);
    const project = service.getProject(input.params.p);
    await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
    const item = invitation(service, input.params.id);
    if (item.projectId !== project.id) fail("NOT_FOUND", 404, "Invitation not found");
    compare(item.version, input.body.expectedVersion);
    context.uow.local((tx) => {
      tx.query("UPDATE invitations SET status='revoked',version=version+1 WHERE id=?").run(item.id);
      accessEvent(service, project.id);
    });
    context.events.dispatch(); return { ok: true as const, version: item.version + 1 };
  });
}
