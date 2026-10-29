import { IdSchema } from "@quire/contracts";
import type { AiRunStep } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { AiStore } from "./store";
import { digest, newId } from "./model";
import type { Actor, CreateRun } from "./model";

export async function reserve(store: AiStore, actor: Actor, input: {
  readonly request: CreateRun; readonly key: string; readonly contextStep: AiRunStep;
}) {
  const { request } = input;
  return store.context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    const authority = await store.authorize(actor, request, tx);
    const existing = await tx.get<{ run_id: string; request_digest: string }>(
      "SELECT run_id,request_digest FROM ai_run_metadata WHERE session_id=? AND idempotency_key=?", [actor.sessionId, input.key]);
    const hash = digest(JSON.stringify(request));
    if (existing) {
      if (hash !== existing.request_digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "AI key already used for different context");
      const prior = await tx.get<{ id: string }>("SELECT id FROM ai_runs WHERE id=?", [existing.run_id]);
      if (!prior) throw new ServiceError("AI_RUN_MISSING", 500, "AI receipt has no run");
      return { run: await store.record(IdSchema.parse(prior.id), tx), created: false };
    }
    const now = store.context.clock.now();
    const day = now.slice(0, 10);
    const count = await tx.get<{ n: number }>("SELECT count(*) AS n FROM ai_usage WHERE user_id=? AND day=? AND state<>'refunded'", [actor.id, day]);
    const limit = authority.policy.aiDailyUses ?? 50;
    if ((count?.n ?? 0) >= limit) throw new ServiceError("AI_DAILY_LIMIT", 429, `Shared daily AI allowance of ${limit} exhausted; resets at 00:00 UTC`);
    const id = newId();
    const usageId = newId();
    const persistent = request.mode === "agent" || request.conversationId !== undefined;
    const retained = persistent ? request : { ...request, prompt: "", selection: request.selection ? { ...request.selection, text: "" } : undefined };
    await tx.run("INSERT INTO ai_usage(id,user_id,day,state,created_at) VALUES(?,?,?,'reserved',?)", [usageId, actor.id, day, now]);
    await tx.run(`INSERT INTO ai_runs(id,actor_id,project_id,branch,mode,status,messages_json,usage_id,created_at,updated_at)
      VALUES(?,?,?,?,?,'queued',?,?,?,?)`,
    [id, actor.id, request.scope.projectId, request.scope.branch, request.mode,
      JSON.stringify(persistent ? [{ role: "user", text: request.prompt }] : []), usageId, now, now]);
    await tx.run(`INSERT INTO ai_run_metadata(run_id,session_id,config_version,operator_policy_version,conversation_id,request_json,request_digest,idempotency_key,lease_until,steps_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [id, actor.sessionId, authority.settings.version, authority.operatorPolicy.version, request.conversationId ?? null, JSON.stringify(retained), hash, input.key,
      new Date(Date.parse(now) + 120_000).toISOString(), JSON.stringify([input.contextStep])]);
    await store.audit(tx, { actorId: actor.id, targetId: id, event: "ai.run.queued" });
    const run = await store.record(id, tx);
    await store.changed(tx, run);
    return { run, created: true };
  });
}
