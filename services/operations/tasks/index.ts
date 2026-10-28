import { z } from "zod";
import { endpoints, IdSchema, OperationSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import type { UpdateClient } from "../updates";
import { getOperation, listOperations } from "./readers";
import { result } from "./store";
import type { Row } from "./store";
async function authorize(context: ModuleContext, request: Request, principal: Principal | null, row: Row) {
  if (row.actor_id !== null) {
    if (principal?.user.id !== row.actor_id) throw new ServiceError("NOT_FOUND", 404, "Operation not found");
  } else {
    const token = request.headers.get("x-project-token");
    if (!token || !await context.db.get(
      "SELECT 1 FROM base_operation_grants WHERE operation_id=? AND token_hash=?",
      [row.id, new Bun.CryptoHasher("sha256").update(token).digest("hex")])) {
      throw new ServiceError("NOT_FOUND", 404, "Operation not found");
    }
  }
  const metadata = z.object({ operatorOnly: z.boolean().optional(), projectIds: z.array(IdSchema).optional() })
    .parse(result(row).result ?? {});
  if ((row.operator_only || metadata.operatorOnly) && !principal?.operator) throw new ServiceError("FORBIDDEN", 403, "Operator access required");
  for (const id of metadata.projectIds ?? []) {
    const project = await context.db.get<{ default_branch: string }>("SELECT default_branch FROM projects WHERE id=? AND deleted_at IS NULL", [id]);
    if (!project) throw new ServiceError("NOT_FOUND", 404, "Project not found");
    await context.services.get("projects").authorizeRequest(request, { projectId: id, branch: project.default_branch }, "read");
  }
}
export function register(context: ModuleContext, updates?: Pick<UpdateClient, "get" | "list">): void {
  context.routes.register(endpoints.operationGet, async (input, request) => {
    const principal = await context.services.get("identity").authenticate(request.request);
    const row = await getOperation(context, input.params.id, principal?.operator ? updates : undefined);
    if (!row) throw new ServiceError("NOT_FOUND", 404, "Operation not found");
    await authorize(context, request.request, principal, row);
    request.responseHeaders.set("cache-control", "private, no-store");
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...operation } = result(row);
    return OperationSchema.parse(operation);
  });
  context.routes.register(endpoints.operationsList, async (input, request) => {
    const principal = await context.services.get("identity").require(request.request);
    const cursor: Id | null = input.query.cursor ? IdSchema.parse(input.query.cursor) : null;
    const kind = input.query.kind ?? null;
    const status = input.query.status ?? null;
    const rows = await listOperations(context, {
      actorId: principal.user.id, cursor, kind, status, limit: input.query.limit + 1,
    }, principal.operator ? updates : undefined);
    const page = rows.slice(0, input.query.limit);
    const items = [];
    for (const row of page) {
      try { await authorize(context, request.request, principal, row); }
      catch (error) {
        if (error instanceof ServiceError && [401, 403, 404].includes(error.status)) continue;
        throw error;
      }
      items.push(result(row));
    }
    request.responseHeaders.set("cache-control", "private, no-store");
    return { items, nextCursor: rows.length > input.query.limit ? page.at(-1)?.id ?? null : null };
  });
}
