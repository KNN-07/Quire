import { ProviderConfigSchema } from "@quire/contracts";
import type { Id, ProviderConfig, SqlExecutor } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

export const AiOperatorPolicySchema = ProviderConfigSchema.unwrap().shape.aiPolicy.unwrap();
export type AiOperatorPolicy = NonNullable<ProviderConfig["aiPolicy"]>;
// Preserve existing consent-gated retrieval on upgrade; logging is opt-in.
export const defaultAiOperatorPolicy: AiOperatorPolicy = {
  requestLogging: "off", citationWebSearch: true, blockConfidentialTags: true, version: 0,
};

export class AiOperatorPolicies {
  constructor(readonly context: ModuleContext) {}
  async get(db: SqlExecutor = this.context.db): Promise<AiOperatorPolicy> {
    const row = await db.get<{ policy_json: string }>("SELECT policy_json FROM adapter_ai_policy WHERE id='ai'");
    return row ? AiOperatorPolicySchema.parse(JSON.parse(row.policy_json)) : defaultAiOperatorPolicy;
  }
  async put(actorId: Id, input: Omit<AiOperatorPolicy, "version"> & { readonly expectedVersion: number }) {
    const result = await this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      if (!await tx.get("SELECT id FROM users WHERE id=? AND operator=1 AND suspended=0 AND deleted_at IS NULL", [actorId])) {
        throw new ServiceError("FORBIDDEN", 403, "Operator required");
      }
      const previous = await this.get(tx);
      if (previous.version !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "AI policy changed; refresh before saving");
      const next = AiOperatorPolicySchema.parse({ requestLogging: input.requestLogging,
        citationWebSearch: input.citationWebSearch, blockConfidentialTags: input.blockConfidentialTags,
        version: previous.version + 1 });
      await tx.run(`INSERT INTO adapter_ai_policy(id,policy_json) VALUES('ai',?)
        ON CONFLICT(id) DO UPDATE SET policy_json=excluded.policy_json`, [JSON.stringify(next)]);
      await tx.run("INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
        [crypto.randomUUID(), this.context.clock.now(), actorId, "ai.operator-policy.updated", actorId, JSON.stringify(next)]);
      await this.context.events.record(tx, { topic: "policy.changed", aggregateId: actorId,
        payload: { resourceId: actorId, version: next.version } });
      return next;
    });
    await this.context.events.dispatch();
    return result;
  }
}
