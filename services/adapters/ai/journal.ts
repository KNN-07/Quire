import { z } from "zod";
import { AiRunSchema, GitOidSchema, IdSchema } from "@quire/contracts";
import type { BranchLease, Id, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { sourceIntent } from "../../core/base";
import type { AiStore } from "./store";
import { scopeOf, UndoSchema } from "./model";

export const JournalSchema = z.object({
  source: sourceIntent, runId: IdSchema, actorId: IdSchema, sessionId: IdSchema,
  expectedVersion: z.number(), key: z.string(), digest: z.string(),
  proposals: AiRunSchema.unwrap().shape.proposals, undo: UndoSchema,
  updates: z.array(z.object({ ref: z.string(), expected: GitOidSchema.nullable(), next: GitOidSchema.nullable() })),
});
export type AiJournalEntry = z.infer<typeof JournalSchema>;
export class AiJournal {
  constructor(readonly store: AiStore) {}
  async stage(id: Id, payload: AiJournalEntry) {
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const run = await this.store.record(payload.runId, tx);
      await this.store.authorize({ id: payload.actorId, sessionId: payload.sessionId }, { scope: scopeOf(run), mode: "agent" }, tx);
      await this.store.core(tx).authorize(payload.actorId, scopeOf(run), "write");
      if (run.version !== payload.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "AI run changed");
      await tx.run("INSERT INTO ai_source_journal(id,run_id,payload_json,created_at) VALUES(?,?,?,?)",
        [id, payload.runId, JSON.stringify(payload), this.store.context.clock.now()]);
    });
  }
  async finalize(tx: Transaction, input: { readonly id: Id; readonly lease: BranchLease; readonly payload: AiJournalEntry }) {
    const { id, lease, payload } = input;
    const run = await this.store.record(payload.runId, tx);
    await this.store.authorize({ id: payload.actorId, sessionId: payload.sessionId }, { scope: scopeOf(run), mode: "agent" }, tx);
    await this.store.core(tx).authorize(payload.actorId, scopeOf(run), "write");
    if (run.version !== payload.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "AI decision was superseded");
    const events = await this.store.core(tx).finalizePreparedSources(tx, { publication: { id, lease },
      sources: [{ source: payload.source, lease }] });
    const next = { ...run, branch: payload.source.snapshot.scope.branch, proposals_json: JSON.stringify(payload.proposals), version: run.version + 1 };
    await tx.run("UPDATE ai_runs SET branch=?,proposals_json=?,version=version+1,updated_at=? WHERE id=?",
      [next.branch, next.proposals_json, this.store.context.clock.now(), run.id]);
    await tx.run("UPDATE ai_run_metadata SET undo_json=? WHERE run_id=?", [JSON.stringify(payload.undo), run.id]);
    await tx.run(`INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at)
      VALUES(?,?,?, ?,200,?,?)`, [payload.actorId, payload.key, `aiDecision:${run.id}`, payload.digest,
      JSON.stringify(this.store.dto(next)), this.store.context.clock.now()]);
    await this.store.audit(tx, { actorId: payload.actorId, targetId: run.id, event: "ai.proposals.applied" });
    for (const event of events) await this.store.context.events.record(tx, event);
    await this.store.context.events.record(tx, { topic: "review.changed", aggregateId: run.project_id,
      payload: { resourceId: run.id, version: next.version } });
    await tx.run("DELETE FROM ai_source_journal WHERE id=?", [id]);
  }
  async recover() {
    for (const raw of await this.store.context.db.all("SELECT id,payload_json FROM ai_source_journal ORDER BY created_at,id")) {
      const row = z.object({ id: IdSchema, payload_json: z.string() }).parse(raw);
      const payload = JournalSchema.parse(JSON.parse(row.payload_json));
      const run = await this.store.record(payload.runId);
      await this.store.authorize({ id: payload.actorId, sessionId: payload.sessionId }, { scope: scopeOf(run), mode: "agent" });
      const lease = await this.store.context.branches.acquire(payload.source.snapshot.scope, crypto.randomUUID(), 60_000);
      if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "AI recovery needs exclusive branch lease");
      try {
        if (await this.store.context.db.get("SELECT 1 FROM repository_intents WHERE id=?", [row.id])) {
          await this.store.context.repositories.recover(row.id, lease);
        } else await this.store.context.repositories.publish({ id: row.id, lease, updates: payload.updates });
        await this.store.context.uow.run(async tx => {
          await tx.lock("quire:accounts");
          await this.finalize(tx, { id: row.id, lease, payload });
        });
      } finally { await this.store.context.branches.release(lease); }
    }
  }
}
