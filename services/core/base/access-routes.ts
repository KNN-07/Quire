import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { CoreProjects } from "./projects";
import { actor, etag, replay, checkMatch } from "./http";
import { compare, fail, newId } from "./store";
import { accessEvent, invitation, accessRequest, addMember, memberRow, secretToken, hashToken } from "./access-records";
import { registerInvitations } from "./invitations";
import { saveHttp } from "./receipts";
import { effectiveAccess } from "./effective-access";
import { writableSelection } from "../../accounts/identity/project-benefits";
import { enqueueNotification } from "../../accounts/governance";

async function requestUpgrade(service: CoreProjects, input: { readonly projectId: Id; readonly userId: Id; readonly role: "reviewer" | "editor" }) {
  const project = await service.getProject(input.projectId);
  const member = z.object({ role: z.enum(["viewer", "reviewer", "editor"]) }).nullable().parse(
    await service.context.db.get("SELECT role FROM project_members WHERE project_id=? AND user_id=?", [input.projectId, input.userId]));
  if (project.ownerId === input.userId || member?.role === "editor" ||
      member?.role === "reviewer" && input.role !== "editor") {
    fail("ACCESS_UPGRADE_REQUIRED", 403, "Request a role above your current project role");
  }
  return project;
}

export function registerAccess(context: ModuleContext, service: CoreProjects): void {
  context.routes.register(endpoints.projectAccess, async (input, request) => {
    request.responseHeaders.set("cache-control", "private, no-store");
    return effectiveAccess(service, request.request, { projectId: input.params.p, branch: input.query.branch });
  });
  context.routes.register(endpoints.projectJoin, async (input, request) => {
    if (input.params.p !== input.body.scope.projectId) fail("SCOPE_MISMATCH", 400, "Project scope mismatch");
    await service.authorizeRequest(request.request, input.body.scope, "write");
    request.responseHeaders.set("cache-control", "private, no-store");
    return effectiveAccess(service, request.request, input.body.scope);
  });
  const owner = async (actorId: Id, projectId: Id) => {
    const project = (await service.getProject(projectId));
    await service.authorize(actorId, { projectId, branch: project.defaultBranch }, "share");
    return project;
  };
  context.routes.register(endpoints.accessGet, async (input, request) => {
    const project = await owner(await actor(context, request), input.params.p);
    (await service.getBranch({ projectId: project.id, branch: input.query.branch }));
    const members = (await Promise.all((await service.rows("SELECT id,user_id,role,version FROM project_members WHERE project_id=? ORDER BY id",
      [project.id], z.object({ id: IdSchema, user_id: IdSchema, role: z.enum(["editor", "reviewer", "viewer"]), version: z.number() })))
      .map(async (member) => {
        const effectiveRole = await service.effectiveRole(member.user_id, project.id, member.role);
        return { user: await service.readUser(member.user_id), role: member.role, version: member.version,
          memberId: member.id, effectiveRole, capacityLimited: member.role !== effectiveRole };
      })));
    const { memberIds, capacity, effectiveCount, selectionRequired } = await writableSelection(context, project.id);
    const invitations = (await Promise.all((await service.rows("SELECT id FROM invitations WHERE project_id=? ORDER BY id",
      [project.id], z.object({ id: IdSchema }))).map(async (row) => (await invitation(service, row.id)))));
    const requests = (await Promise.all((await service.rows("SELECT id FROM access_requests WHERE project_id=? ORDER BY id",
      [project.id], z.object({ id: IdSchema }))).map(async (row) => (await accessRequest(service, row.id)))));
    const link = (await context.db.get<{ role: string }>("SELECT role FROM share_tokens WHERE project_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1", [project.id]));
    etag(request, project.version);
    return {
      members: [{ user: (await service.readUser(project.ownerId)), role: "owner" as const, version: project.version,
        memberId: null, effectiveRole: "owner" as const, capacityLimited: false }, ...members],
      writableSelection: { memberIds: memberIds === null ? null : [...memberIds], capacity, effectiveCount, selectionRequired },
      invitations, requests, link: { role: z.enum(["off", "viewer", "editor"]).parse(link?.role ?? "off"), version: project.version }
    };
  });
  context.routes.register(endpoints.accessWritableMembersPut, async (input, request) => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request.request);
    await identity.verifyMutation(request.request, principal);
    const actorId = principal.user.id;
    const version = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      if (!await tx.get(`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.suspended=0 AND u.deleted_at IS NULL`,
      [principal.sessionId, actorId, context.clock.now()])) fail("UNAUTHENTICATED", 401, "Active owner session required");
      const bound = new CoreProjects({ ...context, db: tx });
      const project = await bound.getProject(input.params.p);
      await bound.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
      compare(project.version, input.body.expectedVersion);
      const selection = await writableSelection(bound.context, project.id);
      const ids = input.body.memberIds;
      if (ids !== null && (new Set(ids).size !== ids.length || ids.some(id => !selection.members.some(member => member.id === id)))) {
        fail("INVALID_WRITABLE_SELECTION", 422, "Select distinct current Editor or Reviewer membership IDs");
      }
      const selected = ids === null ? selection.members : selection.members.filter(member => ids.includes(member.id));
      const actorCapacity = (await bound.policy(actorId, project.id)).writableMembers;
      if ((selection.capacity !== null && selected.length > selection.capacity) ||
        (actorCapacity !== null && selected.length > actorCapacity)) fail("WRITABLE_CAPACITY", 403, "Writable membership capacity reached");
      for (const member of selected) await bound.checkSharing(actorId, project.id, member.user_id);
      await tx.run("UPDATE projects SET writable_member_ids_json=? WHERE id=?", [ids === null ? null : JSON.stringify(ids), project.id]);
      return accessEvent(bound, project.id, tx);
    });
    await context.events.dispatch();
    etag(request, version);
    return { ok: true as const, version };
  });
  context.routes.register(endpoints.accessMemberPatch, async (input, request) => {
    const actorId = await actor(context, request);
    await owner(actorId, input.params.p);
    const member = (await memberRow(service, input.params.p, input.params.id));
    compare(member.version, input.body.expectedVersion);
    const userId = IdSchema.parse(member.user_id);
    await service.checkSharing(actorId, input.params.p, userId);
    await service.checkCapacity(actorId, input.params.p, { role: input.body.role, userId });
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const boundContext = { ...context, db: tx };
      const boundService = new CoreProjects(boundContext);

      compare((await memberRow(boundService, input.params.p, input.params.id)).version, input.body.expectedVersion);
      if ((await boundService.role(actorId, input.params.p)) !== "owner") fail("FORBIDDEN", 403, "Ownership changed");
      await boundService.checkSharing(actorId, input.params.p, userId);
      await boundService.checkCapacity(actorId, input.params.p, { role: input.body.role, userId });
      (await addMember(boundService, { projectId: input.params.p, userId, role: input.body.role }, tx)); (await accessEvent(boundService, input.params.p, tx));

    }));
    (await context.events.dispatch()); etag(request, member.version + 1); return { ok: true as const, version: member.version + 1 };
  });
  context.routes.register(endpoints.accessMemberDelete, async (input, request) => {
    const actorId = await actor(context, request);
    await owner(actorId, input.params.p);
    const member = (await memberRow(service, input.params.p, input.params.id));
    compare(member.version, input.body.expectedVersion);
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const boundContext = { ...context, db: tx };
      const boundService = new CoreProjects(boundContext);

      compare((await memberRow(boundService, input.params.p, input.params.id)).version, input.body.expectedVersion);
      if ((await boundService.role(actorId, input.params.p)) !== "owner") fail("FORBIDDEN", 403, "Ownership changed");
      (await tx.run("DELETE FROM project_members WHERE id=?", [member.id]));
      (await accessEvent(boundService, input.params.p, tx));

    }));
    (await context.events.dispatch()); return { ok: true as const, version: member.version + 1 };
  });
  context.routes.register(endpoints.accessLinkPut, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `accessLink:${input.params.p}`, body: input.body, schema: endpoints.accessLinkPut.output, redact: true }, async (http) => {
      const project = await owner(actorId, input.params.p);
      compare(project.version, input.body.expectedVersion); checkMatch(request, project.version);
      if (input.body.role !== "off" && (await service.policy(actorId, project.id)).sharing !== "anyone") {
        fail("SHARING_POLICY", 403, "Policy prohibits share links");
      }
      const token = secretToken();
      const tokenHash = hashToken(token);
      const version = (await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        const boundContext = { ...context, db: tx };
        const boundService = new CoreProjects(boundContext);

        compare((await boundService.getProject(project.id)).version, input.body.expectedVersion);
        await boundService.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "share");
        if (input.body.role !== "off" && (await boundService.policy(actorId, project.id)).sharing !== "anyone") {
          fail("SHARING_POLICY", 403, "Policy prohibits share links");
        }
        (await tx.run(`DELETE FROM project_members WHERE id IN (
          SELECT m.member_id FROM base_link_members m JOIN share_tokens s ON s.id=m.share_id WHERE s.project_id=?)`, [project.id]));
        (await tx.run("UPDATE share_tokens SET revoked_at=?,revocation_version=revocation_version+1 WHERE project_id=? AND revoked_at IS NULL", [boundContext.clock.now(), project.id]));
        if (input.body.role !== "off") {
          (await tx.run("INSERT INTO share_tokens(id,project_id,token_hash,role,created_at) VALUES(?,?,?,?,?)", [newId(), project.id, tokenHash, input.body.role, boundContext.clock.now()]));
        }
        await saveHttp(boundContext, http, {}, project.version + 1);
        return (await accessEvent(boundService, project.id, tx));

      }));
      (await context.events.dispatch()); request.responseHeaders.set("etag", `"v${version}"`);
      if (input.body.role === "off") return {};
      const url = new URL(`/projects/${project.id}/edit`, context.config.publicUrl); url.searchParams.set("share", token);
      return { urlOnce: url.toString() };
    });
  });
  context.routes.register(endpoints.accessRequest, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `accessRequest:${input.params.p}`, body: input.body, schema: endpoints.accessRequest.output }, async (http) => {
      (await service.getProject(input.params.p));
      compare(0, input.body.expectedVersion);
      const existing = (await context.db.get("SELECT 1 FROM access_requests WHERE project_id=? AND user_id=? AND status='pending'", [input.params.p, actorId]));
      if (existing) fail("REQUEST_PENDING", 409, "An access request is already pending");
      const id = newId();
      (await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        const boundContext = { ...context, db: tx };
        const boundService = new CoreProjects(boundContext);

        const requester = await boundService.readUser(actorId);
        const project = await requestUpgrade(boundService, {
          projectId: input.params.p, userId: actorId, role: input.body.role,
        });
        if (await tx.get("SELECT 1 FROM access_requests WHERE project_id=? AND user_id=? AND status='pending'",
          [input.params.p, actorId])) fail("REQUEST_PENDING", 409, "An access request is already pending");
        (await tx.run("INSERT INTO access_requests(id,project_id,user_id,role,message,created_at) VALUES(?,?,?,?,?,?)", [id, input.params.p, actorId, input.body.role, input.body.message, boundContext.clock.now()]));
        await enqueueNotification(boundContext, {
          userId: project.ownerId, kind: "project.access.requested", resourceId: project.id,
          projectId: project.id, dedupeKey: `access-request:${id}`,
          mail: {
            subject: "Project access requested",
            body: `${requester.name} requests ${input.body.role} access to ${project.name}.\n\n${input.body.message}\n\n${new URL(`/projects/${project.id}/edit`, context.config.publicUrl)}`,
          },
        });
        await saveHttp(boundContext, http, await accessRequest(boundService, id), 0);
        (await accessEvent(boundService, input.params.p, tx));

      }));
      (await context.events.dispatch()); etag(request, 0); return (await accessRequest(service, id));
    });
  });
  context.routes.register(endpoints.accessDecide, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `accessDecide:${input.params.p}:${input.params.id}`, body: input.body, schema: endpoints.accessDecide.output }, async (http) => {
      await owner(actorId, input.params.p);
      const item = (await accessRequest(service, input.params.id));
      if (item.projectId !== input.params.p) fail("NOT_FOUND", 404, "Access request not found");
      compare(item.version, input.body.expectedVersion);
      if (item.status !== "pending") fail("REQUEST_CLOSED", 409, "Request was already decided");
      if (input.body.accept) {
        await service.checkSharing(actorId, item.projectId, item.userId);
        await service.checkCapacity(actorId, item.projectId, { role: item.role, userId: item.userId });
      }
      (await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        const boundContext = { ...context, db: tx };
        const boundService = new CoreProjects(boundContext);

        if ((await boundService.role(actorId, input.params.p)) !== "owner") fail("FORBIDDEN", 403, "Ownership changed");
        const current = await accessRequest(boundService, item.id);
        compare(current.version, input.body.expectedVersion);
        if (current.status !== "pending") fail("REQUEST_CLOSED", 409, "Request was already decided");
        if (input.body.accept) {
          await requestUpgrade(boundService, { projectId: item.projectId, userId: item.userId, role: item.role });
          await boundService.checkSharing(actorId, item.projectId, item.userId);
          await boundService.checkCapacity(actorId, item.projectId, { role: item.role, userId: item.userId });
        }
        if (input.body.accept) (await addMember(boundService, { projectId: item.projectId, userId: item.userId, role: item.role }, tx));
        (await tx.run("UPDATE access_requests SET status=?,version=version+1 WHERE id=?", [input.body.accept ? "accepted" : "declined", item.id]));
        await saveHttp(boundContext, http, await accessRequest(boundService, item.id), item.version + 1);
        (await accessEvent(boundService, item.projectId, tx));

      }));
      (await context.events.dispatch()); etag(request, item.version + 1); return (await accessRequest(service, item.id));
    });
  });
  registerInvitations(context, service);
}
