import { z } from "zod";
import { InstantSchema, assertNever } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { Clock } from "@quire/contracts";
import type { GrantTokens, OAuthConfiguration } from "./contracts";
import type { SafeHttpClient } from "./http";

const responseSchema = z.object({
  access_token: z.string().min(1), token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  refresh_token: z.string().min(1).optional(), expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
});
export class OAuthProtocol {
  constructor(private readonly http: SafeHttpClient, private readonly clock: Clock) {}
  private request(config: OAuthConfiguration, fields: Readonly<Record<string, string>>) {
    const body = new URLSearchParams(fields);
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    switch (config.tokenAuthentication) {
      case "basic":
        if (!config.clientSecret) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Missing OAuth client secret");
        headers["authorization"] = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}`;
        break;
      case "body":
        if (!config.clientSecret) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Missing OAuth client secret");
        body.set("client_id", config.clientId); body.set("client_secret", config.clientSecret);
        break;
      case "none":
        body.set("client_id", config.clientId);
        break;
      default: return assertNever(config.tokenAuthentication);
    }
    return { method: "POST" as const, headers, body: body.toString(), maxBytes: 64 * 1024 };
  }
  async exchange(config: OAuthConfiguration, fields: Readonly<Record<string, string>>, previous?: GrantTokens): Promise<GrantTokens> {
    const response = await this.http.json(config.tokenUrl, responseSchema, this.request(config, fields));
    const scopes = response.scope === undefined ? previous?.scopes ?? config.scopes : response.scope.split(/\s+/).filter(Boolean);
    if (scopes.some((scope) => !config.scopes.includes(scope)) || config.scopes.some((scope) => !scopes.includes(scope))) {
      throw new ServiceError("OAUTH_SCOPE_INVALID", 502, "Provider scopes differ from the minimum requested grant");
    }
    return {
      accessToken: response.access_token, refreshToken: response.refresh_token ?? previous?.refreshToken ?? null,
      tokenType: "Bearer", scopes,
      expiresAt: response.expires_in === undefined ? null
        : InstantSchema.parse(new Date(Date.parse(this.clock.now()) + response.expires_in * 1000).toISOString()),
    };
  }
  async revoke(config: OAuthConfiguration, tokens: GrantTokens): Promise<void> {
    if (!config.revokeUrl) throw new ServiceError("REVOCATION_UNCONFIGURED", 503, "Provider requires an explicit revocation endpoint or implementation");
    const response = await this.http.request(config.revokeUrl, this.request(config, {
      token: tokens.refreshToken ?? tokens.accessToken,
      token_type_hint: tokens.refreshToken ? "refresh_token" : "access_token",
    }));
    if (response.status !== 200) throw new ServiceError("PROVIDER_REVOCATION_FAILED", 502, "Provider did not confirm revocation");
  }
}
