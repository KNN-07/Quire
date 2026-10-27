import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { actor, etag, replay, checkMatch } from "./http";
import { compare, fail, newId } from "./store";
import { accessEvent, invitation, accessRequest, addMember, memberRow, secretToken, hashToken } from "./access-records";
import { registerInvitations } from "./invitations";

export function registerAccess(context: ModuleContext, service: CoreProjects): void {
  const owner = async (actorId: Id, projectId: Id) => {
    const project = service.getProject(projectId);
    await service.authorize(actorId, { projectId, branch: project.defaultBranch }, "share");
    return project;
  };
  context.routes.register(endpoints.accessGet, async (input, request) => {
    const project = await owner(await actor(context, request), input.params.p);
    service.getBranch({ projectId: project.id, branch: input.query.branch });
    const members = service.rows("SELECT user_id,role,version FROM project_members WHERE project_id=? ORDER BY id",
      [project.id], z.object({ user_id: IdSchema, role: z.enum(["editor", "reviewer", "viewer"]), version: z.number() }))
      .map((member) => ({ user: service.readUser(member.user_id), role: member.role, version: member.version }));
    const invitations = service.rows("SELECT id FROM invitations WHERE project_id=? ORDER BY id",
      [project.id], z.object({ id: IdSchema })).map((row) => invitation(service, row.id));
    const requests = service.rows("SELECT id FROM access_requests WHERE project_id=? ORDER BY id",
      [project.id], z.object({ id: IdSchema })).map((row) => accessRequest(service, row.id));
    const link = context.db.query<{ role: string }, [string]>(
      "SELECT role FROM share_tokens WHERE project_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(project.id);
    etag(request, project.version);
    return { members: [{ user: service.readUser(project.ownerId), role: "owner" as const, version: project.version }, ...members],
      invitations, requests, link: { role: z.enum(["off", "viewer", "editor"]).parse(link?.role ?? "off"), version: project.version } };
  });
  context.routes.register(endpoints.accessMemberPatch, async (input, request) => {
    const actorId = await actor(context, request);
    await owner(actorId, input.params.p);
    const member = memberRow(service, input.params.p, input.params.id);
    compare(member.version, input.body.expectedVersion);
    const userId = IdSchema.parse(member.user_id);
    await service.checkSharing(actorId, input.params.p, userId);
    const currentRole = service.role(userId, input.params.p);
    if (currentRole !== "editor") await service.checkCapacity(actorId, input.params.p, input.body.role);
    context.uow.local(() => {
      compare(memberRow(service, input.params.p, input.params.id).version, input.body.expectedVersion);
      if (service.role(actorId, input.params.p) !== "owner") fail("FORBIDDEN", 403, "Ownership changed");
      addMember(service, { projectId: input.params.p, userId, role: input.body.role }); accessEvent(service, input.params.p);
    });
    context.events.dispatch(); etag(request, member.version + 1); return { ok: true as const, version: member.version + 1 };
  });
  context.routes.register(endpoints.accessMemberDelete, async (input, request) => {
    await owner(await actor(context, request), input.params.p);
    const member = memberRow(service, input.params.p, input.params.id);
    compare(member.version, input.body.expectedVersion);
    context.uow.local((tx) => {
      tx.query("DELETE FROM project_members WHERE id=?").run(member.id);
      accessEvent(service, input.params.p);
    });
    context.events.dispatch(); return { ok: true as const, version: member.version + 1 };
  });
  context.routes.register(endpoints.accessLinkPut, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `accessLink:${input.params.p}`, body: input.body, schema: endpoints.accessLinkPut.output, redact: true }, async () => {
      const project = await owner(actorId, input.params.p);
      compare(project.version, input.body.expectedVersion); checkMatch(request, project.version);
      if (input.body.role !== "off" && (await service.policy(actorId, project.id)).sharing !== "anyone") {
        fail("SHARING_POLICY", 403, "Policy prohibits share links");
      }
      const token = secretToken();
      const version = context.uow.local((tx) => {
        compare(service.getProject(project.id).version, input.body.expectedVersion);
        tx.query(`DELETE FROM project_members WHERE id IN (
          SELECT m.member_id FROM base_link_members m JOIN share_tokens s ON s.id=m.share_id WHERE s.project_id=?)`).run(project.id);
        tx.query("UPDATE share_tokens SET revoked_at=?,revocation_version=revocation_version+1 WHERE project_id=? AND revoked_at IS NULL")
          .run(context.clock.now(), project.id);
        if (input.body.role !== "off") {
          tx.query("INSERT INTO share_tokens(id,project_id,token_hash,role,created_at) VALUES(?,?,?,?,?)")
            .run(newId(), project.id, hashToken(token), input.body.role, context.clock.now());
        }
        return accessEvent(service, project.id);
      });
      context.events.dispatch(); request.responseHeaders.set("etag", `"v${version}"`);
      if (input.body.role === "off") return {};
      const url = new URL(`/project/${project.id}`, context.config.publicUrl); url.searchParams.set("share", token);
      return { urlOnce: url.toString() };
    });
  });
  context.routes.register(endpoints.accessRequest, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `accessRequest:${input.params.p}`, body: input.body, schema: endpoints.accessRequest.output }, async () => {
      service.getProject(input.params.p);
      compare(0, input.body.expectedVersion);
      const existing = context.db.query("SELECT 1 FROM access_requests WHERE project_id=? AND user_id=? AND status='pending'").get(input.params.p, actorId);
      if (existing) fail("REQUEST_PENDING", 409, "An access request is already pending");
      const id = newId();
      context.uow.local((tx) => {
        tx.query("INSERT INTO access_requests(id,project_id,user_id,role,message,created_at) VALUES(?,?,?,?,?,?)")
          .run(id, input.params.p, actorId, input.body.role, input.body.message, context.clock.now());
        accessEvent(service, input.params.p);
      });
      context.events.dispatch(); etag(request, 0); return accessRequest(service, id);
    });
  });
  context.routes.register(endpoints.accessDecide, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `accessDecide:${input.params.p}:${input.params.id}`, body: input.body, schema: endpoints.accessDecide.output }, async () => {
      await owner(actorId, input.params.p);
      const item = accessRequest(service, input.params.id);
      if (item.projectId !== input.params.p) fail("NOT_FOUND", 404, "Access request not found");
      compare(item.version, input.body.expectedVersion);
      if (item.status !== "pending") fail("REQUEST_CLOSED", 409, "Request was already decided");
      if (input.body.accept) {
        await service.checkSharing(actorId, item.projectId, item.userId);
        await service.checkCapacity(actorId, item.projectId, item.role);
      }
      context.uow.local((tx) => {
        if (input.body.accept) addMember(service, { projectId: item.projectId, userId: item.userId, role: item.role });
        tx.query("UPDATE access_requests SET status=?,version=version+1 WHERE id=?")
          .run(input.body.accept ? "accepted" : "declined", item.id);
        accessEvent(service, item.projectId);
      });
      context.events.dispatch(); etag(request, item.version + 1); return accessRequest(service, item.id);
    });
  });
  registerInvitations(context, service);
}
