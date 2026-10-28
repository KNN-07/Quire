import { z } from "zod";
import { endpoints, IdSchema, InstantSchema, ProjectSchema } from "@quire/contracts";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { fresh } from "../../accounts/governance/billing";
import { CoreProjects } from "./projects";
import { etag, replay } from "./http";
import { compare, fail, newId } from "./store";
import { saveHttp } from "./receipts";

const deletedProject = z.object({
  id: IdSchema, name: z.string(), ownerId: IdSchema, deletedAt: InstantSchema, version: z.number(),
});
async function requireOperator(context: ModuleContext, request: RequestContext, mutation = false) {
  const identity = context.services.get("identity");
  const principal = await identity.require(request.request);
  if (!principal.operator) fail("FORBIDDEN", 403, "Operator access required");
  if (mutation) {
    await identity.verifyMutation(request.request, principal);
    await fresh(context, principal);
  }
  return principal;
}

export function registerProjectRecovery(context: ModuleContext): void {
  context.routes.register(endpoints.adminDeletedProjects, async (input, request) => {
    await requireOperator(context, request);
    const cursor = input.query.cursor === undefined ? null : IdSchema.parse(input.query.cursor);
    const rows = await context.db.query(`SELECT id,name,owner_id AS "ownerId",deleted_at AS "deletedAt",version
      FROM projects WHERE deleted_at IS NOT NULL AND (CAST(? AS TEXT) IS NULL OR id>?)
      AND (CAST(? AS TEXT) IS NULL OR owner_id=?) ORDER BY id LIMIT ?`,
    [cursor, cursor, input.query.ownerId ?? null, input.query.ownerId ?? null, input.query.limit + 1], deletedProject);
    const items = rows.slice(0, input.query.limit);
    request.responseHeaders.set("cache-control", "private, no-store");
    return { items, nextCursor: rows.length > input.query.limit ? items.at(-1)?.id ?? null : null };
  });
  context.routes.register(endpoints.adminProjectRestore, async (input, request) => {
    const principal = await requireOperator(context, request, true);
    const restored = await replay(context, { actorId: principal.user.id, request,
      route: `adminProjectRestore:${input.params.id}`, body: input.body, schema: ProjectSchema }, async receipt =>
      context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        const bound = { ...context, db: tx };
        const current = await tx.get(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
          WHERE u.id=? AND s.id=? AND u.operator=1 AND u.suspended=0 AND u.deleted_at IS NULL
          AND s.expires_at>?`, [principal.user.id, principal.sessionId, context.clock.now()]);
        if (!current) fail("FORBIDDEN", 403, "Current operator session required");
        await fresh(bound, principal);
        const row = await tx.get(`SELECT id,name,owner_id AS "ownerId",deleted_at AS "deletedAt",version
          FROM projects WHERE id=? AND deleted_at IS NOT NULL`, [input.params.id]);
        if (!row) fail("NOT_FOUND", 404, "Deleted project not found");
        const project = deletedProject.parse(row);
        compare(project.version, input.body.expectedVersion);
        if (input.body.confirmation !== project.name) fail("CONFIRMATION_REQUIRED", 422, "Confirmation must match the project name");
        if (!await tx.get("SELECT id FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL", [project.ownerId])) {
          fail("OWNER_UNAVAILABLE", 409, "Restore an active owner account before recovering its project");
        }
        await tx.run("UPDATE projects SET deleted_at=NULL,updated_at=?,version=version+1 WHERE id=?",
          [context.clock.now(), project.id]);
        await tx.run(`INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json)
          VALUES(?,?,?,NULL,'project.restored',?,?)`, [newId(), context.clock.now(), principal.user.id, project.id,
          JSON.stringify({ ownerId: project.ownerId, deletedAt: project.deletedAt, version: project.version + 1 })]);
        await context.events.record(tx, { topic: "access.changed", aggregateId: project.id,
          payload: { resourceId: project.id, version: project.version + 1 } });
        const result = await new CoreProjects(bound).getProject(project.id);
        await saveHttp(bound, receipt, result, result.version);
        return result;
      }));
    await context.events.dispatch();
    etag(request, restored.version);
    return restored;
  });
}
