import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import type { Id, Operation } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { ProviderConfigurations } from "./configuration";
import type { GrantStore } from "./grants";
import type { AdapterDefinition, ActionContext, PreparedAction } from "./contracts";
import { configurationCapability } from "./contracts";
import { ExecuteActionSchema, actionDigest, assertCursor, authorizeAction, operationEvent, priorOperation } from "./operation-store";
import type { ExecuteAction } from "./operation-store";

export class AdapterOperations {
  private readonly running = new Set<Promise<Operation>>();
  private readonly abort = new AbortController();
  constructor(private readonly services: {
    readonly context: ModuleContext; readonly configuration: ProviderConfigurations; readonly grants: GrantStore;
  }) {}
  execute(definition: AdapterDefinition, raw: ExecuteAction): Promise<Operation> {
    const input = ExecuteActionSchema.parse(raw);
    const execution = this.services.context.admission.writer(() => this.run(definition, input));
    this.running.add(execution);
    void execution.then(() => this.running.delete(execution), () => this.running.delete(execution));
    return execution;
  }
  private async run(definition: AdapterDefinition, input: ExecuteAction): Promise<Operation> {
    const { context, configuration, grants } = this.services;
    this.abort.signal.throwIfAborted();
    const action = definition.actions[input.action];
    if (!action) throw new ServiceError("ACTION_UNSUPPORTED", 422, "Provider does not support this action");
    const owned = await grants.credentials(input.actorId, input.grantId);
    if (owned.grant.provider !== definition.kind) throw new ServiceError("GRANT_PROVIDER_MISMATCH", 400, "Connection belongs to another provider");
    await authorizeAction(context, input, action);
    const previous = await priorOperation(context, input);
    if (previous) return previous;
    const settings = await configuration.get(definition.kind);
    const capability = configurationCapability(definition, settings);
    if (!capability.enabled) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, capability.reason ?? "Provider unavailable");
    if (owned.tokens.expiresAt && owned.tokens.expiresAt <= context.clock.now()) {
      throw new ServiceError("GRANT_EXPIRED", 409, "Refresh the connection before dispatch");
    }
    const claim = await grants.claim({ actorId: input.actorId, grantId: input.grantId, expectedVersion: input.expectedVersion });
    let operationId: Id | null = null;
    let published = false;
    let prepared: PreparedAction | undefined;
    try {
      const admitted = await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        await tx.lock(`adapter:provider:${definition.kind}`);
        await tx.lock(`adapter:grant:${input.grantId}`);
        await tx.lock(`adapter:receipt:${input.actorId}:${input.key}`);
        await grants.assert(claim, tx);
        await authorizeAction({ ...context, db: tx }, input, action);
        const prior = await priorOperation(context, input, tx);
        if (prior) return { operation: prior, fresh: false };
        await assertCursor(tx, input);
        const current = await configuration.get(definition.kind, tx);
        if (current.version !== settings.version) throw new ServiceError("PROVIDER_CHANGED", 409, "Provider configuration changed");
        const id = IdSchema.parse(crypto.randomUUID());
        const operation: Operation = { id, kind: `${definition.kind}.${input.action}`, status: "running", progress: 0, result: null, errorCode: null };
        await tx.run(`INSERT INTO operations(id,actor_id,kind,status,progress,idempotency_key,created_at,updated_at)
          VALUES(?,?,?,'running',0,?,?,?)`, [id, input.actorId, operation.kind, input.key, context.clock.now(), context.clock.now()]);
        await tx.run(`INSERT INTO adapter_operation_receipts(operation_id,grant_id,request_digest,grant_version,config_version)
          VALUES(?,?,?,?,?)`, [id, input.grantId, actionDigest(input), claim.version, settings.version]);
        await operationEvent(context, tx, operation);
        return { operation, fresh: true };
      });
      if (!admitted.fresh) return admitted.operation;
      operationId = admitted.operation.id;
      await context.events.dispatch();
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(120_000)]);
      const actionContext: ActionContext = {
        actorId: input.actorId, ...owned, configuration: settings, expectedCursor: input.expectedCursor,
        key: input.key, signal, ...(input.projectId ? { projectId: input.projectId } : {}),
      };
      prepared = await action.prepare(input.parameters, actionContext);
      signal.throwIfAborted();
      const result = z.record(z.string(), z.json()).parse(prepared.result);
      const serialized = JSON.stringify(result);
      if ([owned.tokens.accessToken, owned.tokens.refreshToken, settings.secret].some(
        (secret) => secret !== null && serialized.includes(secret))) {
        throw new ServiceError("PROVIDER_SECRET_LEAK", 502, "Provider result contains protected credentials");
      }
      const completed: Operation = OperationSchema.parse({ ...admitted.operation, status: "succeeded", progress: 1, result });
      const publication = prepared;
      await context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        await tx.lock(`adapter:provider:${definition.kind}`);
        await tx.lock(`adapter:grant:${input.grantId}`);
        await grants.assert(claim, tx);
        await authorizeAction({ ...context, db: tx }, input, action);
        const current = await configuration.get(definition.kind, tx);
        if (current.version !== settings.version || !configurationCapability(definition, current).enabled) {
          throw new ServiceError("PROVIDER_CHANGED", 409, "Provider configuration changed during operation");
        }
        await assertCursor(tx, input);
        if (publication.publish) await publication.publish(tx);
        await tx.run(`INSERT INTO adapter_cursors(grant_id,action,project_id,cursor,version,updated_at)
          VALUES(?,?,?,?,1,?) ON CONFLICT(grant_id,action,project_id) DO UPDATE SET
          cursor=excluded.cursor,version=adapter_cursors.version+1,updated_at=excluded.updated_at`,
        [input.grantId, input.action, input.projectId ?? "", publication.cursor, context.clock.now()]);
        await tx.run("UPDATE operations SET status='succeeded',progress=1,result_json=?,version=version+1,updated_at=? WHERE id=?",
          [serialized, context.clock.now(), completed.id]);
        await operationEvent(context, tx, completed);
      });
      published = true;
      await context.events.dispatch();
      return completed;
    } catch (error) {
      if (operationId !== null && !published) {
        const failedId = operationId;
        const code = error instanceof ServiceError ? error.code : error instanceof z.ZodError ? "INVALID_ACTION_PARAMETERS" : "ADAPTER_FAILED";
        await context.uow.run(async (tx) => {
          await tx.lock(`adapter:operation:${failedId}`);
          await tx.run("UPDATE operations SET status='failed',error_code=?,version=version+1,updated_at=? WHERE id=? AND status='running'",
            [code, context.clock.now(), failedId]);
          await context.events.record(tx, { topic: "operation.changed", aggregateId: failedId,
            payload: { resourceId: failedId, status: "failed" } });
        });
        await context.events.dispatch();
      }
      if (error instanceof ServiceError || error instanceof z.ZodError) throw error;
      if (error instanceof Error) throw new ServiceError("ADAPTER_FAILED", 502, "Adapter operation failed");
      throw error;
    } finally {
      try { await prepared?.release?.(); }
      finally { await grants.release(claim); }
    }
  }
  async close(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled(this.running);
  }
}
export type { ExecuteAction } from "./operation-store";
