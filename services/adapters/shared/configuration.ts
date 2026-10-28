import { z } from "zod";
import { IdSchema, PolicySchema } from "@quire/contracts";
import type { Id, Policy, ProviderConfig, SqlExecutor } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { defaultPolicy } from "../../accounts/identity/policy";
import { SecretBox } from "./secrets";
import { configurationCapability } from "./contracts";
import type { AdapterDefinition, ProviderSettings } from "./contracts";
import type { SafeHttpClient } from "./http";

const rowSchema = z.object({
  id: IdSchema, kind: z.string(), base_url: z.string(), model: z.string().nullable(),
  encrypted_secret: z.instanceof(Uint8Array).nullable(), policy_json: z.string(),
  enabled: z.number(), version: z.number().int(),
});
export type ConfigureProvider = {
  readonly kind: string; readonly actorId: Id; readonly baseUrl: string;
  readonly model?: string | undefined; readonly secret?: string | undefined; readonly policy: Policy;
  readonly expectedVersion: number;
};
export class ProviderConfigurations {
  private readonly secrets: SecretBox;
  private readonly missingIds = new Map<string, Id>();
  constructor(private readonly context: ModuleContext, private readonly http: SafeHttpClient) {
    this.secrets = new SecretBox(context.secretKey);
  }
  async get(kind: string, executor: SqlExecutor = this.context.db): Promise<ProviderSettings> {
    const row = await executor.get("SELECT * FROM adapter_provider_configs WHERE kind=?", [kind]);
    if (!row) {
      let id = this.missingIds.get(kind);
      if (!id) { id = IdSchema.parse(crypto.randomUUID()); this.missingIds.set(kind, id); }
      return { id, kind, baseUrl: "", secret: null, enabled: false, policy: defaultPolicy, version: 0 };
    }
    const parsed = rowSchema.parse(row);
    return {
      id: parsed.id, kind, baseUrl: parsed.base_url,
      ...(parsed.model === null ? {} : { model: parsed.model }),
      secret: parsed.encrypted_secret ? this.secrets.open(parsed.encrypted_secret, `provider:${kind}`) : null,
      enabled: parsed.enabled === 1, policy: PolicySchema.parse(JSON.parse(parsed.policy_json)), version: parsed.version,
    };
  }
  async put(input: ConfigureProvider): Promise<ProviderSettings> {
    await this.http.validate(input.baseUrl);
    const updated = await this.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await tx.lock(`adapter:provider:${input.kind}`);
      const operator = await tx.get("SELECT id FROM users WHERE id=? AND operator=1 AND suspended=0 AND deleted_at IS NULL", [input.actorId]);
      if (!operator) throw new ServiceError("FORBIDDEN", 403, "Operator required");
      const previous = await this.get(input.kind, tx);
      if (previous.version !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Provider configuration changed");
      const secret = input.secret === undefined ? previous.secret : input.secret || null;
      const version = previous.version + 1;
      await tx.run(`INSERT INTO adapter_provider_configs(id,kind,base_url,model,encrypted_secret,policy_json,enabled,version,updated_at)
        VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(kind) DO UPDATE SET
        base_url=excluded.base_url,model=excluded.model,encrypted_secret=excluded.encrypted_secret,
        policy_json=excluded.policy_json,enabled=excluded.enabled,version=excluded.version,updated_at=excluded.updated_at`,
      [previous.id, input.kind, input.baseUrl, input.model ?? null,
        secret === null ? null : this.secrets.seal(secret, `provider:${input.kind}`),
        JSON.stringify(input.policy), version, this.context.clock.now()]);
      await tx.run("INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
        [crypto.randomUUID(), this.context.clock.now(), input.actorId, "adapter.provider.updated", previous.id,
          JSON.stringify({ kind: input.kind, version, secretChanged: input.secret !== undefined })]);
      await this.context.events.record(tx, { topic: "policy.changed", aggregateId: previous.id,
        payload: { resourceId: previous.id, version } });
      return { id: previous.id, kind: input.kind, baseUrl: input.baseUrl, ...(input.model === undefined ? {} : { model: input.model }),
        secret, enabled: true, policy: input.policy, version };
    });
    await this.context.events.dispatch();
    return updated;
  }
  describe(definition: AdapterDefinition, settings: ProviderSettings): ProviderConfig {
    const capability = configurationCapability(definition, settings);
    return {
      id: settings.id, kind: settings.kind, baseUrl: settings.baseUrl,
      ...(settings.model === undefined ? {} : { model: settings.model }),
      enabled: settings.enabled, secretPresent: settings.secret !== null, version: settings.version,
      policy: settings.policy,
      capabilities: Object.fromEntries(Object.keys(definition.actions).map((name) => [name, capability])),
    };
  }
}
