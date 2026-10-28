import { z } from "zod";
import { IdSchema, OrganizationSchema, MembershipSchema, PolicySchema } from "@quire/contracts";
import type { Endpoint, Id, Policy } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal, RequestContext, Transaction } from "@quire/runtime";

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
export async function organization(context: ModuleContext, id: Id) {
  const value = (await context.db.get("SELECT * FROM organizations WHERE id=?", [id]));
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
export async function authorize(context: ModuleContext, principal: Principal, access: {
  readonly organizationId: Id; readonly level: "member" | "manager" | "admin";
}) {
  const org = (await organization(context, access.organizationId));
  if (principal.operator) return org;
  const row = (await context.db.get("SELECT * FROM members WHERE organization_id=? AND user_id=?", [org.id, principal.user.id]));
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
export async function audit(context: TransactionContext, principal: Principal, input: {
  readonly organizationId: Id | null; readonly event: string; readonly targetId: Id;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}): Promise<void> {
  await context.db.lock("quire:accounts");
  await context.db.run("INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,?,?)", [newId(), context.clock.now(), principal.user.id, input.organizationId, input.event, input.targetId, JSON.stringify(input.details ?? {})]);
}
export async function publishPolicyChange(context: TransactionContext, input: {
  readonly organizationId?: Id; readonly userId?: Id; readonly version: number;
}): Promise<void> {
  await context.db.lock("quire:accounts");
  const rows = z.array(z.object({ id: IdSchema })).parse((await context.db.all(`
SELECT p.id FROM projects p WHERE p.deleted_at IS NULL AND (
  (CAST(? AS TEXT) IS NULL AND CAST(? AS TEXT) IS NULL) OR p.workspace_id=? OR p.owner_id=? OR
  p.owner_id IN (SELECT user_id FROM members WHERE organization_id=?) OR
  EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND
    (m.user_id=? OR m.user_id IN (SELECT user_id FROM members WHERE organization_id=?))))`, [input.organizationId ?? null, input.userId ?? null, input.organizationId ?? null, input.userId ?? null, input.organizationId ?? null, input.userId ?? null, input.organizationId ?? null])));
  for (const row of rows) await context.events.record(context.db, { topic: "policy.changed", aggregateId: row.id,
    payload: { resourceId: row.id, version: input.version } });
}
// The action receives its transaction context explicitly; SQL, receipts and events commit together.
export type TransactionContext = Omit<ModuleContext, "db"> & { readonly db: Transaction };
export function route<I extends z.ZodType, O extends z.ZodType>(context: ModuleContext,
  endpoint: Endpoint<I, O>, action: (input: z.output<I>, principal: Principal, request: RequestContext, context: TransactionContext) => Promise<z.input<NoInfer<O>>>): void {
  context.routes.register(endpoint, async (input, request) => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request.request);
    if (endpoint.method !== "GET") await identity.verifyMutation(request.request, principal);
    const result = await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const bound = { ...context, db: tx };
      const key = request.request.headers.get("idempotency-key");
      const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
      if (endpoint.idempotent && key) {
        const prior = await tx.get("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?", [principal.user.id, key, endpoint.path]);
        if (prior) {
          const row = z.object({ request_digest: z.string(), response_json: z.string() }).parse(prior);
          if (row.request_digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Key already used for different input");
          return endpoint.output.parse(JSON.parse(row.response_json));
        }
      }
      const output = await action(input, principal, request, bound);
      endpoint.output.parse(output);
      if (endpoint.idempotent && key) await tx.run("INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,?,?,?)", [principal.user.id, key, endpoint.path, digest, endpoint.successStatus, JSON.stringify(output), context.clock.now()]);
      return output;
    });
    await context.events.dispatch();
    return endpoint.output.encode(endpoint.output.parse(result));
  });
}
