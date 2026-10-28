import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { Principal } from "@quire/runtime";
import type { AdapterDefinition, AdapterServices, OAuthConfiguration } from "./contracts";
import { configurationCapability } from "./contracts";
import { SecretBox } from "./secrets";
import { OAuthProtocol } from "./oauth-protocol";

const stateSchema = z.object({
  provider: z.string(), owner_id: IdSchema, session_id: IdSchema, verifier: z.instanceof(Uint8Array),
  redirect_uri: z.string(), return_to: z.string(), config_version: z.number().int(),
  expires_at: z.string(), consumed_at: z.string().nullable(),
});
export class ConnectionOAuth {
  private readonly secrets: SecretBox;
  readonly protocol: OAuthProtocol;
  constructor(private readonly services: AdapterServices) {
    this.secrets = new SecretBox(services.context.secretKey);
    this.protocol = new OAuthProtocol(services.http, services.context.clock);
  }
  private async config(definition: AdapterDefinition): Promise<{
    readonly oauth: OAuthConfiguration; readonly version: number;
  }> {
    const settings = await this.services.configuration.get(definition.kind);
    const capability = configurationCapability(definition, settings);
    if (!capability.enabled) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, capability.reason ?? "Provider unavailable");
    if (!definition.oauth) throw new ServiceError("OAUTH_UNSUPPORTED", 422, "Provider uses a different credential enrollment protocol");
    const oauth = definition.oauth(settings);
    if (!oauth.clientId || oauth.scopes.length === 0) {
      throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Missing OAuth client registration or minimum scopes");
    }
    await this.services.http.validate(oauth.authorizationUrl, true);
    await this.services.http.validate(oauth.tokenUrl, true);
    if (oauth.revokeUrl) await this.services.http.validate(oauth.revokeUrl, true);
    return { oauth, version: settings.version };
  }
  async start(definition: AdapterDefinition, principal: Principal, returnTo: string): Promise<{ readonly url: string }> {
    const origin = new URL(this.services.context.config.publicUrl).origin;
    const destination = new URL(returnTo, origin);
    if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\") ||
      returnTo.split("").some((character) => character.charCodeAt(0) < 32) ||
      destination.origin !== origin || destination.hash || !["/settings", "/projects"].some(
        (path) => destination.pathname === path || destination.pathname.startsWith(`${path}/`))) {
      throw new ServiceError("OAUTH_RETURN_DENIED", 400, "Return URL must be an application settings or projects path");
    }
    const { oauth, version } = await this.config(definition);
    const state = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(state).digest("hex");
    const verifier = randomBytes(32).toString("base64url");
    const redirect = new URL(`/api/connections/${encodeURIComponent(definition.kind)}/callback`, origin).href;
    await this.services.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await this.services.grants.activeActor(principal.user.id, tx);
      const session = await tx.get("SELECT id FROM sessions WHERE id=? AND user_id=? AND expires_at>?",
        [principal.sessionId, principal.user.id, this.services.context.clock.now()]);
      if (!session) throw new ServiceError("UNAUTHENTICATED", 401, "Session expired before connection start");
      await tx.run(`INSERT INTO adapter_oauth_states
        (digest,provider,owner_id,session_id,verifier,redirect_uri,return_to,config_version,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, [digest, definition.kind, principal.user.id, principal.sessionId,
        this.secrets.seal(verifier, `oauth:${digest}`), redirect, destination.pathname + destination.search,
        version, new Date(Date.parse(this.services.context.clock.now()) + 10 * 60_000).toISOString()]);
    });
    const url = new URL(oauth.authorizationUrl);
    for (const [key, value] of Object.entries(oauth.authorizationParameters ?? {})) url.searchParams.set(key, value);
    for (const [key, value] of Object.entries({
      response_type: "code", client_id: oauth.clientId, redirect_uri: redirect,
      scope: oauth.scopes.join(" "), state, code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    })) url.searchParams.set(key, value);
    return { url: url.href };
  }
  async callback(definition: AdapterDefinition, principal: Principal, query: {
    readonly state?: string | undefined; readonly code?: string | undefined; readonly error?: string | undefined;
  }): Promise<string> {
    if (!query.state || !/^[A-Za-z0-9_-]{43}$/.test(query.state)) {
      throw new ServiceError("OAUTH_STATE_INVALID", 400, "Connection state is absent or invalid");
    }
    const digest = createHash("sha256").update(query.state).digest("hex");
    const { oauth, version } = await this.config(definition);
    const state = await this.services.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await tx.lock(`adapter:oauth:${digest}`);
      const value = await tx.get("SELECT * FROM adapter_oauth_states WHERE digest=?", [digest]);
      if (!value) throw new ServiceError("OAUTH_STATE_INVALID", 400, "Connection state does not exist");
      const row = stateSchema.parse(value);
      if (row.provider !== definition.kind || row.owner_id !== principal.user.id || row.session_id !== principal.sessionId ||
        row.expires_at <= this.services.context.clock.now() || row.consumed_at !== null || row.config_version !== version) {
        throw new ServiceError("OAUTH_STATE_INVALID", 400, "Connection state expired, was used, or belongs to another session/provider");
      }
      await tx.run("UPDATE adapter_oauth_states SET consumed_at=? WHERE digest=?", [this.services.context.clock.now(), digest]);
      return row;
    });
    if (query.error) throw new ServiceError("OAUTH_DENIED", 400, "Provider denied authorization");
    if (!query.code) throw new ServiceError("OAUTH_CODE_REQUIRED", 400, "Authorization code required");
    const tokens = await this.protocol.exchange(oauth, {
      grant_type: "authorization_code", code: query.code, redirect_uri: state.redirect_uri,
      code_verifier: this.secrets.open(state.verifier, `oauth:${digest}`),
    });
    await this.services.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await tx.lock(`adapter:provider:${definition.kind}`);
      const session = await tx.get("SELECT id FROM sessions WHERE id=? AND user_id=? AND expires_at>?",
        [principal.sessionId, principal.user.id, this.services.context.clock.now()]);
      if (!session) throw new ServiceError("UNAUTHENTICATED", 401, "Session expired during token exchange");
      const current = await this.services.configuration.get(definition.kind, tx);
      if (current.version !== version || !configurationCapability(definition, current).enabled) {
        throw new ServiceError("PROVIDER_CHANGED", 409, "Provider configuration changed during token exchange");
      }
      const grant = await this.services.grants.create({
        actorId: principal.user.id, provider: definition.kind, label: definition.label, tokens,
      }, tx);
      await this.services.context.events.record(tx, { topic: "policy.changed", aggregateId: grant.id,
        payload: { resourceId: grant.id, version: grant.version } });
    });
    await this.services.context.events.dispatch();
    return state.return_to;
  }
}
