import { z } from "zod";
import { IdSchema, ScopeSchema, SuggestionSchema, ProposedEditSchema } from "@quire/contracts";
import type { ProposedEdit } from "@quire/contracts";
import type { SourceFinalization } from "../base";
import { sourceFinalization } from "../base/source-finalization";
import type { ReviewMutations } from "./mutations";
import { notifyReview } from "./notifications";

export const decisionPlan = z.object({
  actorId: IdSchema, scope: ScopeSchema, ids: z.array(IdSchema), editIds: z.array(IdSchema),
  key: z.string(), route: z.string(), digest: z.string(), sourceKey: z.string(),
  finalization: sourceFinalization.optional(),
  edits: z.array(ProposedEditSchema).optional(),
});
export type DecisionPlan = z.infer<typeof decisionPlan>;
export const decisionId = (plan: DecisionPlan): string => `${plan.actorId}:${plan.route}:${plan.key}`;

export async function acceptance(store: ReviewMutations, plan: DecisionPlan, edits: readonly ProposedEdit[]): Promise<SourceFinalization> {
  const statements: SourceFinalization["statements"] = [];
  const append = (sql: string, parameters: (string | number | boolean | null)[], changes = 1) => statements.push({ sqlite: sql, postgres: sql, parameters, changes });
  for (const edit of edits) append("UPDATE suggestion_edits SET status='accepted',version=version+1 WHERE id=? AND status='pending'", [edit.id]);
  const result = [];
  for (const id of plan.ids) {
    const current = await store.suggestion(id, plan.scope.projectId);
    append("UPDATE suggestions SET version=version+1 WHERE id=? AND version=?", [id, current.version]);
    result.push({ ...current.dto, edits: current.dto.edits.map(edit => ({ ...edit, status: plan.editIds.includes(edit.id) ? "accepted" as const : edit.status })) });
  }
  append("DELETE FROM review_decision_intents WHERE id=?", [decisionId(plan)]);
  const finalization: SourceFinalization = { statements, receipts: [{ actorId: plan.actorId, key: plan.key,
    route: plan.route, digest: plan.digest, response: JSON.stringify(z.array(SuggestionSchema).parse(result)) }],
    events: [{ topic: "review.changed", aggregateId: plan.scope.projectId,
      payload: { resourceId: plan.scope.projectId, version: (await store.projects.getBranch(plan.scope)).revision + 1 } }] };
  for (const suggestion of result) await notifyReview(store, { type: "suggestion", suggestion, actorId: plan.actorId,
    eventId: `suggestion:${suggestion.id}:decision:${plan.actorId}:${plan.key}` }, finalization);
  return finalization;
}

/** Only pre-portability decisions need post-source metadata reconciliation. */
export async function finishDecisions(store: ReviewMutations): Promise<void> {
  const context = store.context;
  for (const row of await context.db.all<{ payload_json: string }>("SELECT payload_json FROM review_decision_intents")) {
    const plan = decisionPlan.parse(JSON.parse(row.payload_json));
    if (plan.finalization && plan.edits) {
      const result = await store.projects.applyEdits(plan.actorId, plan.scope, plan.edits, plan.sourceKey, plan.finalization);
      if (result.conflicts.length) await store.projects.serialized(plan.scope, lease => context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        await context.branches.assert(tx, lease);
        if (!await tx.get("SELECT 1 FROM review_decision_intents WHERE id=?", [decisionId(plan)])) return;
        const bound = store.withTransaction(tx);
        for (const edit of plan.edits ?? []) await tx.run("UPDATE suggestion_edits SET status=?,version=version+1 WHERE id=? AND status='pending'", [result.conflicts.includes(edit.id) ? "conflict" : "pending", edit.id]);
        for (const id of plan.ids) await tx.run("UPDATE suggestions SET version=version+1 WHERE id=?", [id]);
        const dtos = await Promise.all(plan.ids.map(async id => (await bound.suggestion(id, plan.scope.projectId)).dto));
        for (const suggestion of dtos) await notifyReview(bound, { type: "suggestion", suggestion, actorId: plan.actorId, eventId: `suggestion:${suggestion.id}:decision:${plan.actorId}:${plan.key}` });
        await tx.run("INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,200,?,?)", [plan.actorId, plan.key, plan.route, plan.digest, JSON.stringify(dtos), context.clock.now()]);
        await tx.run("DELETE FROM review_decision_intents WHERE id=?", [decisionId(plan)]);
        await bound.changed(plan.scope);
      }));
      continue;
    }
    if (!await context.db.get("SELECT 1 FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
      [plan.actorId, plan.sourceKey, `applyEdits:${plan.scope.projectId}:${plan.scope.branch}`])) continue;
    await store.projects.serialized(plan.scope, lease => context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await context.branches.assert(tx, lease);
      const receipt = await tx.get("SELECT 1 FROM idempotency_results WHERE actor_id=? AND key=? AND route=?", [plan.actorId, plan.sourceKey, `applyEdits:${plan.scope.projectId}:${plan.scope.branch}`]);
      if (!receipt || !await tx.get("SELECT 1 FROM review_decision_intents WHERE id=?", [decisionId(plan)])) return;
      const bound = store.withTransaction(tx);
      for (const id of plan.editIds) await tx.run("UPDATE suggestion_edits SET status='accepted',version=version+1 WHERE id=? AND status='pending'", [id]);
      for (const id of plan.ids) await tx.run("UPDATE suggestions SET version=version+1 WHERE id=?", [id]);
      const result = await Promise.all(plan.ids.map(async id => (await bound.suggestion(id, plan.scope.projectId)).dto));
      for (const suggestion of result) await notifyReview(bound, { type: "suggestion", suggestion, actorId: plan.actorId, eventId: `suggestion:${suggestion.id}:decision:${plan.actorId}:${plan.key}` });
      await tx.run("INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at) VALUES(?,?,?,?,200,?,?)", [plan.actorId, plan.key, plan.route, plan.digest, JSON.stringify(result), context.clock.now()]);
      await tx.run("DELETE FROM review_decision_intents WHERE id=?", [decisionId(plan)]);
      await bound.changed(plan.scope);
    }));
  }
}
