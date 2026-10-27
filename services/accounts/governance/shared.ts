import { z } from "zod";
import { IdSchema, OrganizationSchema, MembershipSchema, PolicySchema } from "@quire/contracts";
import type { Endpoint, Id, Policy } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal, RequestContext } from "@quire/runtime";

export const newId = () => IdSchema.parse(crypto.randomUUID());
export const initialPolicy: Policy = PolicySchema.parse({
  compileSeconds: 180, writableMembers: null, historyDays: null, trackChanges: true,
  chat: true, ai: "off", aiDailyUses: 50, sharing: "named", anonymousRead: false, anonymousEdit: false,
});
export function conflict(actual: number, expected: number): void {
  if (actual !== expected) throw new ServiceError("VERSION_CONFLICT", 409, "Resource changed; refresh and retry");
}
export const missing = () => new ServiceError("NOT_FOUND", 404, "Resource not found");
export const denied = () => new ServiceError("FORBIDDEN", 403, "Insufficient permission");
export function organization(context: ModuleContext, id: Id) {
  const value = context.db.query("SELECT * FROM organizations WHERE id=?").get(id);
  if (!value) throw missing();
  const row = z.object({ id: IdSchema, slug: z.string(), name: z.string(), kind: z.string(),
    domains_json: z.string(), policy_json: z.string(), version: z.number() }).parse(value);
  return OrganizationSchema.parse({ id: row.id, slug: row.slug, name: row.name, kind: row.kind,
    version: row.version, domains: JSON.parse(row.domains_json), policy: JSON.parse(row.policy_json) });
}
export function membership(value: unknown) {
  const row = z.object({ id: IdSchema, organization_id: IdSchema, user_id: IdSchema,
    role: z.string(), licensed: z.number(), version: z.number() }).parse(value);
  return MembershipSchema.parse({ id: row.id, organizationId: row.organization_id,
    userId: row.user_id, role: row.role, licensed: Boolean(row.licensed), version: row.version });
}
export function authorize(context: ModuleContext, principal: Principal, access: {
  readonly organizationId: Id; readonly level: "member" | "manager" | "admin";
}) {
  const org = organization(context, access.organizationId);
  if (principal.operator) return org;
  const row = context.db.query("SELECT * FROM members WHERE organization_id=? AND user_id=?")
    .get(org.id, principal.user.id);
  if (!row) throw denied();
  const member = membership(row);
  const ranks = { member: 0, manager: 1, admin: 2 } as const;
  if (ranks[member.role] < ranks[access.level]) throw denied();
  return org;
}
export function page<T extends { readonly id: string }>(items: readonly T[], limit: number) {
  const visible = items.slice(0, limit);
  return { items: visible, nextCursor: items.length > limit ? visible.at(-1)?.id ?? null : null };
}
export function audit(context: ModuleContext, principal: Principal, input: {
  readonly organizationId: Id | null; readonly event: string; readonly targetId: Id;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}): void {
  context.db.query("INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,?,?)")
    .run(newId(), context.clock.now(), principal.user.id, input.organizationId, input.event, input.targetId,
      JSON.stringify(input.details ?? {}));
}
export function publishPolicyChange(context: ModuleContext, input: {
  readonly organizationId?: Id; readonly userId?: Id; readonly version: number;
}): void {
  const rows = z.array(z.object({ id: IdSchema })).parse(context.db.query(`
SELECT p.id FROM projects p WHERE p.deleted_at IS NULL AND (
  (? IS NULL AND ? IS NULL) OR p.workspace_id=? OR p.owner_id=? OR
  p.owner_id IN (SELECT user_id FROM members WHERE organization_id=?) OR
  EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND
    (m.user_id=? OR m.user_id IN (SELECT user_id FROM members WHERE organization_id=?))))`)
    .all(input.organizationId ?? null, input.userId ?? null, input.organizationId ?? null, input.userId ?? null,
      input.organizationId ?? null, input.userId ?? null, input.organizationId ?? null));
  for (const row of rows) context.events.append(context.db, { topic: "policy.changed", aggregateId: row.id,
    payload: { resourceId: row.id, version: input.version } });
}
// Every handler authenticates before accessing durable state. Mutations, their audit/outbox
// records and their replay receipt share one synchronous SQLite transaction.
export function route<I extends z.ZodType, O extends z.ZodType>(context: ModuleContext,
  endpoint: Endpoint<I, O>, action: (input: z.output<I>, principal: Principal, request: RequestContext) => z.input<NoInfer<O>>): void {
  context.routes.register(endpoint, async (input, request) => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request.request);
    if (endpoint.method === "GET") return action(input, principal, request);
    await identity.verifyMutation(request.request, principal);
    const result = context.uow.local<unknown>(() => {
      const key = request.request.headers.get("idempotency-key");
      const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
      if (endpoint.idempotent && key) {
        const prior = context.db.query("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?")
          .get(principal.user.id, key, endpoint.path);
        if (prior) {
          const row = z.object({ request_digest: z.string(), response_json: z.string() }).parse(prior);
          if (row.request_digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Key already used for different input");
          return endpoint.output.parse(JSON.parse(row.response_json));
        }
      }
      const output = action(input, principal, request);
      endpoint.output.parse(output);
      if (endpoint.idempotent && key) context.db.query(
        "INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(principal.user.id, key, endpoint.path, digest, endpoint.successStatus, JSON.stringify(output), context.clock.now());
      return output;
    });
    context.events.dispatch();
    return endpoint.output.encode(endpoint.output.parse(result));
  });
}
