import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import type { Id, Transaction, Operation } from "@quire/contracts";
import type { ModuleContext, Principal } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { billingAccount, ensureBillingAccount, fresh } from "../../accounts/governance/billing";
import { authorize, conflict } from "../../accounts/governance/shared";
import { BindingSchema, digest, fail, seconds } from "./contracts";
import type { Merchant } from "./contracts";

export type BillingRequest = {
  readonly organizationId: Id; readonly expectedVersion: number;
  readonly principal: Principal; readonly request: Request;
};
export async function authority(context: ModuleContext, input: BillingRequest) {
  await authorize(context, input.principal, { organizationId: input.organizationId, level: "admin" });
  await fresh(context, input.principal);
  const active = await context.services.get("identity").require(input.request);
  if (active.user.id !== input.principal.user.id) fail("FORBIDDEN", "Billing principal changed", 403);
  return context.uow.run(async (tx) => {
    const bound = { ...context, db: tx };
    const account = await ensureBillingAccount(bound, input.organizationId, active.user.primaryEmail);
    conflict(account.version, input.expectedVersion);
    return account;
  });
}
export async function publicationAuthority(context: ModuleContext, tx: Transaction, input: BillingRequest) {
  await tx.lock("quire:accounts");
  const session = await tx.get(`SELECT u.operator FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.deleted_at IS NULL AND u.suspended=0`,
  [input.principal.sessionId, input.principal.user.id, context.clock.now()]);
  if (!session) fail("UNAUTHENTICATED", "Billing session revoked", 401);
  const operator = z.object({ operator: z.number() }).parse(session).operator === 1;
  const bound = { ...context, db: tx };
  await authorize(bound, { ...input.principal, operator }, { organizationId: input.organizationId, level: "admin" });
  await fresh(bound, input.principal);
  const account = await billingAccount(bound, input.organizationId);
  conflict(account.version, input.expectedVersion);
}
export async function binding(merchant: Merchant, input: BillingRequest) {
  const previous = await merchant.context.db.get("SELECT * FROM billing_merchant_bindings WHERE organization_id=?", [input.organizationId]);
  if (previous) return BindingSchema.parse(previous);
  const configuration = await merchant.settings();
  const account = await billingAccount(merchant.context, input.organizationId);
  const customer = await merchant.call("customers", z.object({ id: z.string().startsWith("cus_") }), {
    fields: { email: account.invoiceEmail, "metadata[quire_organization]": input.organizationId },
    key: `quire-customer-${input.organizationId}`,
  });
  await merchant.context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    await publicationAuthority(merchant.context, tx, input);
    const latest = await merchant.configuration.get(configuration.kind, tx);
    if (!latest.enabled || latest.version !== configuration.version) fail("VERSION_CONFLICT", "Merchant configuration changed during customer creation");
    await tx.run("INSERT INTO billing_merchant_bindings(organization_id,customer_id) VALUES(?,?) ON CONFLICT(organization_id) DO NOTHING",
      [input.organizationId, customer.id]);
  });
  return BindingSchema.parse(await merchant.context.db.get("SELECT * FROM billing_merchant_bindings WHERE organization_id=?", [input.organizationId]));
}
export type Claim = { readonly organizationId: Id; readonly token: string; readonly generation: number };
export async function claim(context: ModuleContext, organizationId: Id): Promise<Claim> {
  return context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    const row = BindingSchema.parse(await tx.get("SELECT * FROM billing_merchant_bindings WHERE organization_id=?", [organizationId]));
    if (row.claim && row.claim_until && row.claim_until > context.clock.now()) fail("BILLING_BUSY", "Another merchant operation is active");
    const token = crypto.randomUUID();
    await tx.run("UPDATE billing_merchant_bindings SET claim=?,claim_until=?,generation=generation+1 WHERE organization_id=?",
      [token, seconds(Date.parse(context.clock.now()) / 1000 + 120), organizationId]);
    return { organizationId, token, generation: row.generation + 1 };
  });
}
export async function fence(tx: Transaction, input: Claim, now: string) {
  await tx.lock("quire:accounts");
  const row = BindingSchema.parse(await tx.get("SELECT * FROM billing_merchant_bindings WHERE organization_id=?", [input.organizationId]));
  if (row.claim !== input.token || row.generation !== input.generation || !row.claim_until || row.claim_until <= now)
    fail("BILLING_FENCE_LOST", "Merchant claim expired or was replaced");
  return row;
}
export async function release(context: ModuleContext, input: Claim) {
  await context.db.run("UPDATE billing_merchant_bindings SET claim=NULL,claim_until=NULL WHERE organization_id=? AND claim=? AND generation=?",
    [input.organizationId, input.token, input.generation]);
}
export async function operation(merchant: Merchant, input: BillingRequest, action: {
  readonly kind: string; readonly parameters: Readonly<Record<string, unknown>>;
  readonly prepare: (key: string, publish: (work: (tx: Transaction) => Promise<void>) => Promise<void>) => Promise<Readonly<Record<string, unknown>>>;
  readonly complete?: (tx: Transaction, result: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>;
}): Promise<Operation> {
  const context = merchant.context;
  const key = input.request.headers.get("idempotency-key");
  if (!key) fail("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required", 400);
  const hash = digest(JSON.stringify({ org: input.organizationId, kind: action.kind, parameters: action.parameters }));
  const load = async (tx: Transaction) => {
    const row = await tx.get("SELECT digest,operation_json FROM billing_merchant_receipts WHERE actor_id=? AND key=?", [input.principal.user.id, key]);
    if (!row) return null;
    const parsed = z.object({ digest: z.string(), operation_json: z.string() }).parse(row);
    if (parsed.digest !== hash) fail("IDEMPOTENCY_CONFLICT", "Key belongs to different billing input");
    return OperationSchema.parse(JSON.parse(parsed.operation_json));
  };
  // Check current authority before replay, but allow replay after reconciliation advances version.
  await authorize(context, input.principal, { organizationId: input.organizationId, level: "admin" });
  await fresh(context, input.principal);
  const prior = await context.uow.run(load);
  if (prior) return prior;
  await authority(context, input);
  const configuration = await merchant.settings();
  await binding(merchant, input);
  const lease = await claim(context, input.organizationId);
  const pending = OperationSchema.parse({ id: IdSchema.parse(crypto.randomUUID()), kind: action.kind,
    status: "running", progress: 0, result: null, errorCode: null });
  try {
    const replay = await context.uow.run(async (tx) => {
      await fence(tx, lease, context.clock.now());
      await publicationAuthority(context, tx, input);
      const existing = await load(tx);
      if (existing) return existing;
      await tx.run("INSERT INTO billing_merchant_receipts(actor_id,key,digest,operation_json,request_json,organization_id) VALUES(?,?,?,?,?,?)",
        [input.principal.user.id, key, hash, JSON.stringify(pending), JSON.stringify(action.parameters), input.organizationId]);
      await tx.run(`INSERT INTO operations(id,actor_id,kind,status,progress,idempotency_key,created_at,updated_at)
        VALUES(?,?,?,'running',0,?,?,?)`, [pending.id, input.principal.user.id, pending.kind,
        `billing:${key}`, context.clock.now(), context.clock.now()]);
      await context.events.record(tx, { topic: "operation.changed", aggregateId: pending.id,
        payload: { resourceId: pending.id, status: pending.status } });
      return null;
    });
    if (replay) return replay;
    // Persist intent before external dispatch. Uncertain completion stays running and is never reissued.
    const result = await action.prepare(`quire-${pending.id}`, (work) => context.uow.run(async (tx) => {
      await fence(tx, lease, context.clock.now());
      await publicationAuthority(context, tx, input);
      const current = await merchant.configuration.get(configuration.kind, tx);
      if (!current.enabled || current.version !== configuration.version) fail("VERSION_CONFLICT", "Merchant configuration changed");
      await work(tx);
    }));
    await authority(context, input);
    const completed = await context.uow.run(async (tx) => {
      await fence(tx, lease, context.clock.now());
      await publicationAuthority(context, tx, input);
      const current = await merchant.configuration.get(configuration.kind, tx);
      if (!current.enabled || current.version !== configuration.version) fail("VERSION_CONFLICT", "Merchant configuration changed");
      const output = action.complete ? await action.complete(tx, result) : result;
      const done = OperationSchema.parse({ ...pending, status: "succeeded", progress: 1, result: output });
      await tx.run("UPDATE billing_merchant_receipts SET operation_json=? WHERE actor_id=? AND key=?",
        [JSON.stringify(done), input.principal.user.id, key]);
      await tx.run("UPDATE operations SET status='succeeded',progress=1,result_json=?,version=version+1,updated_at=? WHERE id=?",
        [JSON.stringify({ organizationId: input.organizationId, blob: null, projectIds: [] }), context.clock.now(), done.id]);
      await context.events.record(tx, { topic: "operation.changed", aggregateId: done.id,
        payload: { resourceId: done.id, status: done.status } });
      return done;
    });
    await context.events.dispatch();
    return completed;
  } catch (error) {
    if (error instanceof ServiceError && error.status < 500) {
      await context.uow.run(async (tx) => {
        await fence(tx, lease, context.clock.now());
        const failed = { ...pending, status: "failed", errorCode: error.code };
        await tx.run("UPDATE billing_merchant_receipts SET operation_json=? WHERE actor_id=? AND key=?",
          [JSON.stringify(failed), input.principal.user.id, key]);
        await tx.run("UPDATE operations SET status='failed',error_code=?,version=version+1,updated_at=? WHERE id=?",
          [error.code, context.clock.now(), pending.id]);
        await context.events.record(tx, { topic: "operation.changed", aggregateId: pending.id,
          payload: { resourceId: pending.id, status: "failed" } });
      });
      await context.events.dispatch();
    }
    throw error;
  } finally { await release(context, lease); }
}
