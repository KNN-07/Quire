import { z } from "zod";
import type { Id, Scope, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { AiStore } from "./store";
import { CreateRunSchema, MessagesSchema, newId } from "./model";
import type { Actor, RunRecord } from "./model";

export class AiConversations {
  private readonly local = new Map<string, z.infer<typeof MessagesSchema>>();
  private readonly runMessages = new Map<Id, z.infer<typeof MessagesSchema>>();
  constructor(readonly store: AiStore, readonly retentionDays: number) {}
  private key(actor: Actor, scope: Scope) { return `${actor.sessionId}:${scope.projectId}:${scope.branch}`; }
  async create(actor: Actor, projectId: Id) {
    const project = await this.store.core().getProject(projectId);
    const id = newId();
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.store.authorize(actor, { scope: { projectId, branch: project.defaultBranch }, mode: "ask" }, tx);
      if (!(await this.store.core(tx).policy(actor.id, projectId)).chat) throw new ServiceError("AI_CONVERSATION_DISABLED", 403, "Shared chat disabled by policy");
      await this.store.core(tx).authorize(actor.id, { projectId, branch: project.defaultBranch }, "chat");
      const now = this.store.context.clock.now();
      await tx.run("INSERT INTO ai_conversations(id,project_id,author_id,shared,created_at,updated_at) VALUES(?,?,?,1,?,?)",
        [id, projectId, actor.id, now, now]);
      await tx.run("INSERT INTO ai_conversation_retention(conversation_id,expires_at) VALUES(?,?)",
        [id, new Date(Date.parse(now) + this.retentionDays * 86400_000).toISOString()]);
      await this.store.audit(tx, { actorId: actor.id, targetId: id, event: "ai.conversation.shared" });
    });
    return { id, projectId, version: 0, messages: [] };
  }
  async get(actor: Actor, input: { readonly id: Id; readonly projectId: Id }, db = this.store.context.db) {
    const project = await this.store.core(db).getProject(input.projectId);
    await this.store.core(db).authorize(actor.id, { projectId: input.projectId, branch: project.defaultBranch }, "read");
    if (!(await this.store.core(db).policy(actor.id, input.projectId)).chat) throw new ServiceError("AI_CONVERSATION_DISABLED", 403, "Shared chat disabled by policy");
    const row = await db.get(`SELECT c.version,c.messages_json FROM ai_conversations c
      JOIN ai_conversation_retention r ON r.conversation_id=c.id
      WHERE c.id=? AND c.project_id=? AND c.shared=1 AND r.expires_at>?`,
    [input.id, input.projectId, this.store.context.clock.now()]);
    if (!row) throw new ServiceError("AI_CONVERSATION_NOT_FOUND", 404, "Shared conversation cleared, expired or inaccessible");
    const parsed = z.object({ version: z.number(), messages_json: z.string() }).parse(row);
    return { id: input.id, projectId: input.projectId, version: parsed.version, messages: MessagesSchema.parse(JSON.parse(parsed.messages_json)) };
  }
  async history(actor: Actor, input: { readonly scope: Scope; readonly conversationId?: Id | undefined }) {
    return input.conversationId ? (await this.get(actor, { id: input.conversationId, projectId: input.scope.projectId })).messages
      : this.local.get(this.key(actor, input.scope)) ?? [];
  }
  messages(run: RunRecord) { return run.conversation_id ? undefined : this.runMessages.get(run.id); }
  remember(actor: Actor, run: RunRecord, messages: z.infer<typeof MessagesSchema>) {
    if (!run.conversation_id) this.runMessages.set(run.id, messages);
    if (!run.conversation_id) {
      const key = this.key(actor, { projectId: run.project_id, branch: run.branch });
      this.local.set(key, [...this.local.get(key) ?? [], ...messages]);
    }
  }
  async append(tx: Transaction, run: RunRecord, messages: z.infer<typeof MessagesSchema>) {
    if (!run.conversation_id) return;
    const shared = await this.get({ id: run.actor_id, sessionId: run.session_id },
      { id: run.conversation_id, projectId: run.project_id }, tx);
    await tx.run("UPDATE ai_conversations SET messages_json=?,version=version+1,updated_at=? WHERE id=?",
      [JSON.stringify([...shared.messages, ...messages]), this.store.context.clock.now(), run.conversation_id]);
  }
  async clear(actor: Actor, input: { readonly id: Id; readonly projectId: Id; readonly expectedVersion: number }) {
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const shared = await this.get(actor, input, tx);
      const project = await this.store.core(tx).getProject(input.projectId);
      await this.store.core(tx).authorize(actor.id, { projectId: input.projectId, branch: project.defaultBranch }, "write");
      if (shared.version !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Conversation changed");
      await tx.run("UPDATE ai_conversations SET shared=0,messages_json='[]',version=version+1 WHERE id=?", [input.id]);
      await tx.run("UPDATE ai_runs SET messages_json='[]' WHERE id IN (SELECT run_id FROM ai_run_metadata WHERE conversation_id=?) AND mode='ask'", [input.id]);
      await this.redact(tx, [input.id]);
      await this.store.audit(tx, { actorId: actor.id, targetId: input.id, event: "ai.conversation.cleared" });
      await this.store.context.events.record(tx, { topic: "policy.changed", aggregateId: input.projectId,
        payload: { resourceId: input.projectId, version: shared.version + 1 } });
    });
    await this.store.context.events.dispatch();
    return { ok: true as const, version: input.expectedVersion + 1 };
  }
  async clearSession(actor: Actor, scope: Scope) {
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.store.core(tx).authorize(actor.id, scope, "read");
      const rows = await tx.all<{ id: Id; usage_id: Id }>(`SELECT r.id,r.usage_id FROM ai_runs r
        JOIN ai_run_metadata m ON m.run_id=r.id WHERE m.session_id=? AND r.project_id=? AND r.branch=?
        AND m.conversation_id IS NULL AND r.mode='ask'`, [actor.sessionId, scope.projectId, scope.branch]);
      for (const row of rows) {
        await tx.run("UPDATE ai_runs SET status='canceled',version=version+1 WHERE id=? AND status IN ('queued','running')", [row.id]);
        await tx.run("UPDATE ai_usage SET state='refunded',refunded_at=? WHERE id=? AND state='reserved'", [this.store.context.clock.now(), row.usage_id]);
        this.runMessages.delete(row.id);
      }
      await this.store.audit(tx, { actorId: actor.id, targetId: scope.projectId, event: "ai.session.cleared" });
      await this.store.context.events.record(tx, { topic: "policy.changed", aggregateId: scope.projectId,
        payload: { resourceId: scope.projectId, version: 0 } });
    });
    this.local.delete(this.key(actor, scope));
    await this.store.context.events.dispatch();
    return { ok: true as const, version: 0 as const };
  }
  async expire() {
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const expired = await tx.all<{ conversation_id: Id }>("SELECT conversation_id FROM ai_conversation_retention WHERE expires_at<=?", [this.store.context.clock.now()]);
      await this.redact(tx, expired.map(row => row.conversation_id));
      await tx.run(`UPDATE ai_runs SET messages_json='[]' WHERE mode='ask' AND id IN
        (SELECT m.run_id FROM ai_run_metadata m JOIN ai_conversation_retention r ON r.conversation_id=m.conversation_id WHERE r.expires_at<=?)`,
      [this.store.context.clock.now()]);
      await tx.run("UPDATE ai_conversations SET shared=0,messages_json='[]' WHERE id IN (SELECT conversation_id FROM ai_conversation_retention WHERE expires_at<=?)", [this.store.context.clock.now()]);
    });
  }
  private async redact(tx: Transaction, ids: readonly Id[]) {
    for (const id of ids) for (const row of await tx.all<{ run_id: Id; request_json: string }>(`SELECT m.run_id,m.request_json
      FROM ai_run_metadata m JOIN ai_runs r ON r.id=m.run_id WHERE m.conversation_id=? AND r.mode='ask'`, [id])) {
      const request = CreateRunSchema.parse(JSON.parse(row.request_json));
      await tx.run("UPDATE ai_run_metadata SET request_json=? WHERE run_id=?",
        [JSON.stringify({ ...request, prompt: "", ...(request.selection ? { selection: { ...request.selection, text: "" } } : {}) }), row.run_id]);
    }
  }
  close() { this.local.clear(); this.runMessages.clear(); }
}
