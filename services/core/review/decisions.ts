import { z } from "zod";
import { IdSchema, ScopeSchema, SuggestionSchema } from "@quire/contracts";
import type { ReviewMutations } from "./mutations";
import { notifyReview } from "./notifications";

export const decisionPlan = z.object({
  actorId: IdSchema, scope: ScopeSchema, ids: z.array(IdSchema), editIds: z.array(IdSchema),
  key: z.string(), route: z.string(), digest: z.string(), sourceKey: z.string(),
});
export type DecisionPlan = z.infer<typeof decisionPlan>;
export const decisionId = (plan: DecisionPlan): string => `${plan.actorId}:${plan.route}:${plan.key}`;
/** Reconcile accepted metadata from the source writer's durable receipt, including crash recovery. */
export function finishDecisions(store: ReviewMutations): void {
  const context = store.context;
  const rows = context.db.query<{ payload_json: string }, []>("SELECT payload_json FROM review_decision_intents").all();
  for (const row of rows) {
    const plan = decisionPlan.parse(JSON.parse(row.payload_json));
    const receipt = context.db.query("SELECT 1 FROM idempotency_results WHERE actor_id=? AND key=? AND route=?")
      .get(plan.actorId, plan.sourceKey, `applyEdits:${plan.scope.projectId}:${plan.scope.branch}`);
    if (!receipt) continue;
    context.uow.local(tx => {
      for (const id of plan.editIds) tx.query("UPDATE suggestion_edits SET status='accepted',version=version+1 WHERE id=? AND status='pending'").run(id);
      for (const id of plan.ids) tx.query("UPDATE suggestions SET version=version+1 WHERE id=?").run(id);
      const result = plan.ids.map(id => store.suggestion(id, plan.scope.projectId).dto);
      for (const suggestion of result) notifyReview(store, { type: "suggestion", suggestion, actorId: plan.actorId,
        eventId: `suggestion:${suggestion.id}:decision:${plan.actorId}:${plan.key}` });
      tx.query(`INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at)
        VALUES(?,?,?,?,200,?,?)`).run(plan.actorId, plan.key, plan.route, plan.digest,
          JSON.stringify(z.array(SuggestionSchema).parse(result)), context.clock.now());
      tx.query("DELETE FROM review_decision_intents WHERE id=?").run(decisionId(plan));
      store.changed(plan.scope);
    });
  }
}
