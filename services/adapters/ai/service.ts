import { ServiceError } from "@quire/runtime";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { SafeHttpClient } from "../shared";
import type { AdapterServices } from "../shared";
import type { PublicationRetrieval } from "../references";
import { OpenAiChat } from "./provider";
import { AiStore } from "./store";
import { AiConversations } from "./conversations";
import { AiExecution } from "./execution";
import { AiDecisions } from "./decisions";
import { collectContext, uploadImage } from "./context";
import { reserve } from "./admission";
import { actorOf, CreateRunSchema, digest, scopeOf } from "./model";
import type { Actor, CreateRun, RunRecord } from "./model";

export type AiOptions = {
  readonly termsVersion?: string; readonly retentionDays?: number; readonly visionModels?: readonly string[];
  readonly retrieval?: () => PublicationRetrieval;
  readonly http?: SafeHttpClient;
};
export class AiService {
  readonly store: AiStore;
  readonly conversations: AiConversations;
  readonly execution: AiExecution;
  readonly decisions: AiDecisions;
  private readonly active = new Map<Id, { readonly controller: AbortController; readonly run: RunRecord; readonly done: Promise<void> }>();
  private readonly checks = new Set<Promise<void>>();
  private unsubscribe: (() => void) | undefined;
  private closed = false;
  private readonly backgroundErrors: unknown[] = [];
  constructor(services: AdapterServices, readonly options: AiOptions = {}) {
    this.store = new AiStore(services, options.termsVersion ?? "2026-10-27");
    this.conversations = new AiConversations(this.store, options.retentionDays ?? 30);
    this.execution = new AiExecution(this.store, this.conversations, new OpenAiChat(options.http ?? new SafeHttpClient({ maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 })));
    this.decisions = new AiDecisions(this.store);
  }
  async start() {
    this.execution.retrieval = this.options.retrieval?.();
    await this.decisions.journal.recover();
    await this.conversations.expire();
    // No automatic replay of uncertain paid calls after process loss.
    for (const row of await this.store.context.db.all<{ id: string }>(`SELECT r.id FROM ai_runs r JOIN ai_run_metadata m ON m.run_id=r.id
      WHERE r.status IN ('queued','running') AND m.lease_until<?`, [this.store.context.clock.now()])) {
      const run = await this.store.record(IdSchema.parse(row.id));
      await this.execution.fail(run.id, new ServiceError("AI_INTERRUPTED", 409, "Process stopped; regenerate explicitly"));
    }
    this.unsubscribe = this.store.context.events.subscribe(event => {
      if (!["policy.changed", "access.changed", "session.revoked", "operation.changed"].includes(event.topic)) return;
      const check = this.store.context.admission.background(async () => {
        for (const { controller, run } of this.active.values()) {
          try {
            await this.store.recheck(run);
            if ((await this.store.record(run.id)).status === "canceled") controller.abort();
            if (run.conversation_id) await this.conversations.get(actorOf(run), { id: run.conversation_id, projectId: run.project_id });
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            controller.abort(error);
          }
        }
      });
      this.checks.add(check);
      void check.then(() => this.checks.delete(check), error => {
        this.backgroundErrors.push(error); this.checks.delete(check);
      });
    });
  }
  async create(actor: Actor, input: { readonly request: CreateRun; readonly key: string }) {
    if (this.closed) throw new ServiceError("AI_CLOSED", 503, "AI service is closing");
    await this.conversations.expire();
    const request = CreateRunSchema.parse(input.request);
    const authority = await this.store.authorize(actor, request);
    const prior = await this.store.context.db.get<{ run_id: string; request_digest: string }>(
      "SELECT run_id,request_digest FROM ai_run_metadata WHERE session_id=? AND idempotency_key=?", [actor.sessionId, input.key]);
    if (prior) {
      if (prior.request_digest !== digest(JSON.stringify(request))) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "AI key already used for different context");
      return (await this.get(actor, IdSchema.parse(prior.run_id))).run;
    }
    if (!request.prompt.trim()) throw new ServiceError("AI_PROMPT_REQUIRED", 400, "Prompt is required");
    if (authority.preferences.aiModel && authority.preferences.aiModel !== authority.settings.model) {
      throw new ServiceError("AI_MODEL_UNCONFIGURED", 400, "Selected model is not the operator-configured model");
    }
    if (request.tool === "inline-completion" && !authority.preferences.inlineCompletion) {
      throw new ServiceError("AI_INLINE_DISABLED", 403, "Enable inline completion explicitly");
    }
    if (request.conversationId) await this.conversations.get(actor, { id: request.conversationId, projectId: request.scope.projectId });
    const selected = await collectContext(this.store, actor, request);
    if (selected.images.length && !this.options.visionModels?.includes(authority.settings.model ?? "")) {
      throw new ServiceError("AI_MODALITY_UNSUPPORTED", 422, "Configured model is not explicitly enabled for PNG/JPEG inputs");
    }
    const admitted = await reserve(this.store, actor, { request, key: input.key });
    if (admitted.created) {
      if (this.closed) {
        await this.execution.fail(admitted.run.id, new ServiceError("AI_CANCELED", 409, "AI service closed before dispatch"));
        return (await this.get(actor, admitted.run.id)).run;
      }
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
      const done = this.store.context.admission.background(() =>
        this.execution.execute({ run: admitted.run, request, selected, signal })
          .catch(error => this.execution.fail(admitted.run.id, signal.aborted ? signal.reason : error)));
      this.active.set(admitted.run.id, { controller, run: admitted.run, done });
      void done.then(() => this.active.delete(admitted.run.id), error => {
        this.backgroundErrors.push(error); this.active.delete(admitted.run.id);
      });
    }
    return this.store.dto(admitted.run, this.conversations.messages(admitted.run));
  }
  async get(actor: Actor, id: Id) {
    await this.conversations.expire();
    const run = await this.store.accessible(actor, id);
    return { run: this.store.dto(run, this.conversations.messages(run)), version: run.version, errorCode: run.error_code };
  }
  async cancel(actor: Actor, input: { readonly id: Id; readonly expectedVersion: number }) {
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const run = await this.store.accessible(actor, input.id, tx);
      if (run.actor_id !== actor.id) await this.store.core(tx).authorize(actor.id, scopeOf(run), "write");
      if (run.version !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "AI run changed");
      if (run.status !== "queued" && run.status !== "running") throw new ServiceError("AI_RUN_FINISHED", 409, "AI run already finished");
      await tx.run("UPDATE ai_runs SET status='canceled',version=version+1 WHERE id=?", [run.id]);
      await tx.run("UPDATE ai_usage SET state='refunded',refunded_at=? WHERE id=? AND state='reserved'", [this.store.context.clock.now(), run.usage_id]);
      await this.store.audit(tx, { actorId: actor.id, targetId: run.id, event: "ai.run.canceled" });
      await this.store.changed(tx, { ...run, status: "canceled" });
    });
    this.active.get(input.id)?.controller.abort();
    await this.store.context.events.dispatch();
    return { ok: true as const, version: input.expectedVersion + 1 };
  }
  upload(actor: Actor, input: Parameters<typeof uploadImage>[2]) { return uploadImage(this.store, actor, input); }
  async close() {
    this.closed = true;
    this.unsubscribe?.();
    for (const { controller } of this.active.values()) controller.abort();
    await Promise.allSettled([...this.active.values()].map(item => item.done).concat([...this.checks]));
    this.conversations.close();
    if (this.backgroundErrors.length) throw new AggregateError(this.backgroundErrors, "AI background persistence failed");
  }
}
