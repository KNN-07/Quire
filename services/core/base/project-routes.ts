import { z } from "zod";
import { endpoints, ProjectSchema, OperationSchema, IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { CoreProjects } from "./projects";
import { actor, etag, replay } from "./http";
import { compare, fail, newId } from "./store";
import { exportSource, recordOperation, downloadOperation } from "./operations";
import { sourceZip } from "./archives";
import { zipSync } from "fflate";
import { listProjects, listWorkspaces } from "./project-list";
import { delegatedExport } from "./export-adapter";
import { anonymousExport } from "./anonymous-export";
import { saveHttp } from "./receipts";
import { recordProjectTransfer } from "../../accounts/governance/managed";

export function registerProjectRoutes(context: ModuleContext, service: CoreProjects): void {
  const { register } = context.routes;
  register(endpoints.projectWorkspaces, async (input, request) => {
    request.responseHeaders.set("cache-control", "private, no-store");
    return listWorkspaces(service, await actor(context, request), input.query);
  });
  register(endpoints.projectList, async (input, request) => (await listProjects(service, await actor(context, request), input.query)));
  register(endpoints.adminProjects, async (input, request) => {
    const principal = await context.services.get("identity").require(request.request);
    if (!principal.operator) fail("FORBIDDEN", 403, "Operator access required");
    const cursor = input.query.cursor === undefined ? null : IdSchema.parse(input.query.cursor);
    let projectId: Id | null = null;
    if (input.query.url) {
      const path = new URL(input.query.url, context.config.publicUrl).pathname;
      const parsed = IdSchema.safeParse(path.split("/").filter(Boolean).at(-1));
      if (!parsed.success) fail("INVALID_PROJECT_URL", 422, "Choose a project URL ending in its identifier");
      projectId = parsed.data;
    }
    const rows = z.array(z.object({ id: IdSchema })).parse((await context.db.all("SELECT id FROM projects WHERE deleted_at IS NULL AND (CAST(? AS TEXT) IS NULL OR id>?) AND (CAST(? AS TEXT) IS NULL OR id=?) ORDER BY id LIMIT ?", [cursor, cursor, projectId, projectId, input.query.limit + 1])));
    const visible = rows.slice(0, input.query.limit);
    return {
      items: (await Promise.all(visible.map(async row => (await service.getProject(row.id))))),
      nextCursor: rows.length > input.query.limit ? visible.at(-1)?.id ?? null : null
    };
  });
  register(endpoints.projectCreate, async (input, request) => {
    const actorId = await actor(context, request);
    const result = await replay(context, { actorId, request, body: input.body, route: "projectCreate", schema: ProjectSchema },
      (http) => service.create(actorId, { ...input.body, ...(http ? { http } : {}) }));
    etag(request, result.version); return result;
  });
  register(endpoints.projectGet, async (input, request) => {
    await service.authorizeRequest(request.request, { projectId: input.params.p, branch: input.query.branch }, "read");
    const project = (await service.getProject(input.params.p)); etag(request, project.version); return project;
  });
  register(endpoints.projectPatch, async (input, request) => {
    const result = await service.patch(await actor(context, request), { ...input.body, projectId: input.params.p });
    etag(request, result.version); return result;
  });
  register(endpoints.projectCopy, async (input, request) => {
    const actorId = await actor(context, request);
    const result = await replay(context, { actorId, request, route: `projectCopy:${input.params.p}`, body: input.body, schema: ProjectSchema },
      (http) => service.copy(actorId, { projectId: input.params.p, ...input.body, request: request.request, ...(http ? { http } : {}) }));
    etag(request, result.version); return result;
  });
  register(endpoints.projectBulk, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: "projectBulk", body: input.body, schema: OperationSchema }, async (http) => {
      const ids = input.body.items.map((item) => item.id);
      if (new Set(ids).size !== ids.length) fail("INVALID_BULK", 400, "Each project may appear only once");
      for (const item of input.body.items) {
        const id = item.id;
        const project = (await service.getProject(id));
        await service.authorize(actorId, { projectId: id, branch: project.defaultBranch }, "read");
        compare((await service.getProject(id)).version, item.expectedVersion);
      }
      const preflight = async (boundService: CoreProjects) => {
        for (const item of input.body.items) {
          compare((await boundService.getProject(item.id)).version, item.expectedVersion);
          (await boundService.role(actorId, item.id));
        }
      };
      if (input.body.action === "download") {
        const entries: Record<string, Uint8Array> = Object.create(null);
        const snapshots = (await context.uow.run(async (tx) => {
          await tx.lock("quire:accounts");
          const boundContext = { ...context, db: tx };
          const boundService = new CoreProjects(boundContext);

          await preflight(boundService);
          return (await Promise.all(ids.map(async (id) => {
            const project = (await boundService.getProject(id));
            const revision = (await boundService.getBranch({ projectId: id, branch: project.defaultBranch })).revision;
            const snapshot = (await boundService.one(`SELECT id FROM snapshots WHERE project_id=? AND branch=? AND revision=?
              ORDER BY created_at DESC,id DESC LIMIT 1`, [id, project.defaultBranch, revision], z.object({ id: IdSchema })));
            return (await boundService.getSnapshot(snapshot.id));
          })));

        }));
        for (const snapshot of snapshots) {
          entries[`${snapshot.scope.projectId}.zip`] = await sourceZip(service, snapshot);
        }
        return recordOperation(service, {
          actorId, projectIds: ids, kind: "bulk-download",
          key: request.request.headers.get("idempotency-key") ?? newId(), bytes: zipSync(entries), preflight,
          ...(http ? { http } : {})
        });
      }
      const state = input.body.action === "restore" ? "active" : input.body.action === "archive" ? "archived" : "trash";
      return recordOperation(service, {
        actorId, projectIds: ids, kind: `bulk-${input.body.action}`,
        key: request.request.headers.get("idempotency-key") ?? newId(), ...(http ? { http } : {}),
        preflight: async (boundService, tx) => {
          await preflight(boundService);
          for (const item of input.body.items) {
            const id = item.id;
            const updated = (await tx.run("UPDATE projects SET version=version+1 WHERE id=? AND version=?", [id, item.expectedVersion]));
            if (updated.changes !== 1) compare((await boundService.getProject(id)).version, item.expectedVersion);
            (await tx.run(`INSERT INTO project_user_state(project_id,user_id,state,version,updated_at)
            VALUES(?,?,?,1,?) ON CONFLICT(project_id,user_id) DO UPDATE SET state=excluded.state,
            version=project_user_state.version+1,updated_at=excluded.updated_at`, [id, actorId, state, context.clock.now()]));
          }
        }
      });
    });
  });
  register(endpoints.projectLeave, async (input, request) => {
    const actorId = await actor(context, request);
    const project = (await service.getProject(input.params.p));
    await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "read");
    if (project.ownerId === actorId) fail("OWNER_CANNOT_LEAVE", 403, "Transfer ownership before leaving");
    const member = (await service.one("SELECT version FROM project_members WHERE project_id=? AND user_id=?",
      [project.id, actorId], z.object({ version: z.number() })));
    compare(member.version, input.body.expectedVersion);
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const boundContext = { ...context, db: tx };

      (await tx.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [project.id, actorId]));
      (await tx.run("DELETE FROM project_user_state WHERE project_id=? AND user_id=?", [project.id, actorId]));
      await boundContext.events.record(tx, { topic: "access.changed", aggregateId: project.id, payload: { resourceId: project.id, version: project.version } });

    }));
    (await context.events.dispatch()); return { ok: true as const, version: member.version + 1 };
  });
  register(endpoints.projectTransfer, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `transfer:${input.params.p}`, body: input.body, schema: endpoints.projectTransfer.output }, async (http) => {
      const project = (await service.getProject(input.params.p));
      await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "transfer");
      compare(project.version, input.body.expectedVersion);
      if ((await service.readUser(actorId)).managedBy !== null) fail("MANAGED_TRANSFER_REQUIRED", 403, "Managed owners require an authorized administrator transfer");
      if (project.ownerId === input.body.newOwnerId) fail("INVALID_OWNER", 422, "Choose a different collaborator");
      (await service.readUser(input.body.newOwnerId));
      (await service.one("SELECT id FROM project_members WHERE project_id=? AND user_id=?", [project.id, input.body.newOwnerId], z.object({ id: z.string() })));
      await service.checkSharing(actorId, project.id, input.body.newOwnerId);
      (await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        const boundContext = { ...context, db: tx };
        const boundService = new CoreProjects(boundContext);

        const current = await boundService.getProject(project.id);
        compare(current.version, input.body.expectedVersion);
        await boundService.authorize(actorId, { projectId: current.id, branch: current.defaultBranch }, "transfer");
        if ((await boundService.readUser(actorId)).managedBy !== null) fail("MANAGED_TRANSFER_REQUIRED", 403, "Managed owners require an authorized administrator transfer");
        if (current.ownerId === input.body.newOwnerId) fail("INVALID_OWNER", 422, "Choose a different collaborator");
        await boundService.readUser(input.body.newOwnerId);
        await boundService.one("SELECT id FROM project_members WHERE project_id=? AND user_id=?",
          [project.id, input.body.newOwnerId], z.object({ id: IdSchema }));
        await boundService.checkSharing(actorId, project.id, input.body.newOwnerId);
        (await tx.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [project.id, input.body.newOwnerId]));
        (await tx.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)", [newId(), project.id, actorId, boundContext.clock.now()]));
        (await tx.run("UPDATE projects SET owner_id=?,version=version+1,updated_at=? WHERE id=?", [input.body.newOwnerId, boundContext.clock.now(), project.id]));
        await saveHttp(boundContext, http, { ok: true, version: project.version + 1 }, project.version + 1);
        await recordProjectTransfer(boundContext, { projectId: project.id, from: actorId,
          to: input.body.newOwnerId, version: project.version + 1 });

      }));
      (await context.events.dispatch()); etag(request, project.version + 1); return { ok: true, version: project.version + 1 };
    });
  });
  register(endpoints.projectDelete, async (input, request) => {
    const actorId = await actor(context, request);
    const project = (await service.getProject(input.params.p));
    await service.authorize(actorId, { projectId: project.id, branch: project.defaultBranch }, "delete");
    compare(project.version, input.body.expectedVersion);
    if (input.body.confirmation !== project.name) fail("CONFIRMATION_REQUIRED", 422, "Confirmation must match the project name");
    (await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const boundContext = { ...context, db: tx };
      const boundService = new CoreProjects(boundContext);

      compare((await boundService.getProject(project.id)).version, input.body.expectedVersion);
      if ((await boundService.role(actorId, project.id)) !== "owner") fail("FORBIDDEN", 403, "Ownership changed");
      (await tx.run("UPDATE projects SET deleted_at=?,version=version+1 WHERE id=?", [boundContext.clock.now(), project.id]));
      (await tx.run("UPDATE share_tokens SET revoked_at=? WHERE project_id=?", [boundContext.clock.now(), project.id]));
      await boundContext.events.record(tx, { topic: "access.changed", aggregateId: project.id, payload: { resourceId: project.id, version: project.version + 1 } });

    }));
    (await context.events.dispatch()); return { ok: true as const, version: project.version + 1 };
  });
  register(endpoints.projectExport, async (input, request) => {
    const principal = await context.services.get("identity").authenticate(request.request);
    if (!principal) {
      if (input.body.kind !== "source") fail("UNAUTHENTICATED", 401, "Sign in for conversion exports");
      return anonymousExport(service, request, {
        projectId: input.params.p,
        key: request.request.headers.get("idempotency-key") ?? newId(),
        ...(input.body.snapshotId ? { snapshotId: input.body.snapshotId } : {})
      });
    }
    const actorId = await actor(context, request);
    const project = (await service.getProject(input.params.p));
    await service.authorizeRequest(request.request, { projectId: project.id, branch: project.defaultBranch }, "download");
    return replay(context, { actorId, request, route: `export:${input.params.p}`, body: input.body, schema: OperationSchema },
      async (http) => {
        const details = {
          projectId: input.params.p, key: request.request.headers.get("idempotency-key") ?? newId(),
          ...(input.body.snapshotId ? { snapshotId: input.body.snapshotId } : {})
        };
        if (input.body.kind === "source") return exportSource(service, actorId, {
          ...details, request: request.request,
          ...(http ? { http } : {})
        });
        return delegatedExport(context, { ...details, actorId, kind: input.body.kind });
      });
  });
  register(endpoints.operationDownload, async (input, request) => {
    const principal = await context.services.get("identity").authenticate(request.request);
    return new Uint8Array(await downloadOperation(service, principal?.user.id ?? null, {
      id: input.params.id, request: request.request, responseHeaders: request.responseHeaders,
    }));
  });
}
