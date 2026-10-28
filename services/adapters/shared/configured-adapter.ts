import type { Capability, ExternalAdapter, Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { AdapterDefinition, AdapterServices, GrantContext, ProviderSettings } from "./contracts";
import { configurationCapability } from "./contracts";
import { ExecuteActionSchema } from "./operation-store";
import { OAuthProtocol } from "./oauth-protocol";

export class ConfiguredAdapter implements ExternalAdapter {
  constructor(
    readonly definition: AdapterDefinition,
    private readonly services: AdapterServices,
    private settings: ProviderSettings,
  ) {}
  capabilities(): Readonly<Record<string, Capability>> {
    const capability = configurationCapability(this.definition, this.settings);
    return Object.fromEntries(Object.keys(this.definition.actions).map((action) => [action, capability]));
  }
  async availability(): Promise<Capability> {
    this.settings = await this.services.configuration.get(this.definition.kind);
    return configurationCapability(this.definition, this.settings);
  }
  async requireReady(): Promise<ProviderSettings> {
    const capability = await this.availability();
    if (!capability.enabled) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, capability.reason ?? "Provider unavailable");
    return this.settings;
  }
  async test(grantId: Id, actorId: Id): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    const settings = await this.requireReady();
    const owned = await this.services.grants.credentials(actorId, grantId);
    if (owned.grant.provider !== this.definition.kind) throw new ServiceError("GRANT_PROVIDER_MISMATCH", 400, "Connection belongs to another provider");
    if (owned.tokens.expiresAt && owned.tokens.expiresAt <= this.services.context.clock.now()) {
      return { ok: false, reason: "Access token expired; refresh the connection" };
    }
    const result = await this.definition.test({ actorId, ...owned, configuration: settings, signal: AbortSignal.timeout(15_000) });
    const current = await this.services.grants.read(actorId, grantId);
    if (current.version !== owned.grant.version || current.state !== "ready") {
      throw new ServiceError("VERSION_CONFLICT", 409, "Connection changed during test");
    }
    return result;
  }
  execute(input: Parameters<ExternalAdapter["execute"]>[0]) {
    return this.services.operations.execute(this.definition, ExecuteActionSchema.parse(input));
  }
  async refresh(input: { readonly actorId: Id; readonly grantId: Id; readonly expectedVersion: number }): Promise<void> {
    const settings = await this.requireReady();
    const claim = await this.services.grants.claim(input);
    try {
      const owned = await this.services.grants.credentials(input.actorId, input.grantId);
      if (owned.grant.provider !== this.definition.kind) throw new ServiceError("GRANT_PROVIDER_MISMATCH", 400, "Connection belongs to another provider");
      if (!owned.tokens.refreshToken || !this.definition.oauth) {
        throw new ServiceError("REFRESH_UNAVAILABLE", 422, "Provider requires reconnection; no refresh token or OAuth refresh contract");
      }
      const protocol = new OAuthProtocol(this.services.http, this.services.context.clock);
      const tokens = await protocol.exchange(this.definition.oauth(settings),
        { grant_type: "refresh_token", refresh_token: owned.tokens.refreshToken }, owned.tokens);
      await this.services.grants.replace(claim, tokens, async (tx) => {
        const current = await this.services.configuration.get(this.definition.kind, tx);
        if (current.version !== settings.version) throw new ServiceError("PROVIDER_CHANGED", 409, "Provider changed during refresh");
      });
      await this.services.context.events.dispatch();
    } finally { await this.services.grants.release(claim); }
  }
  async disconnect(input: { readonly actorId: Id; readonly grantId: Id; readonly expectedVersion: number }) {
    const settings = await this.requireReady();
    const claim = await this.services.grants.claim(input);
    try {
      const owned = await this.services.grants.credentials(input.actorId, input.grantId);
      if (owned.grant.provider !== this.definition.kind) throw new ServiceError("GRANT_PROVIDER_MISMATCH", 400, "Connection belongs to another provider");
      const context: GrantContext = { actorId: input.actorId, ...owned, configuration: settings, signal: AbortSignal.timeout(15_000) };
      switch (this.definition.revoke) {
        case "local": break;
        case undefined:
          if (!this.definition.oauth) throw new ServiceError("REVOCATION_UNCONFIGURED", 503, "Provider requires an explicit revocation contract");
          await new OAuthProtocol(this.services.http, this.services.context.clock).revoke(this.definition.oauth(settings), owned.tokens);
          break;
        default: await this.definition.revoke(context);
      }
      const removed = await this.services.grants.replace(claim, null);
      await this.services.context.events.dispatch();
      return { ok: true as const, version: removed.version };
    } finally { await this.services.grants.release(claim); }
  }
}
