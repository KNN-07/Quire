import { z } from "zod";
import { assertNever } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { Clock } from "@quire/contracts";
import { configurationCapability } from "../shared";
import type { AdapterContribution, AdapterDefinition, ProviderSettings, SafeHttpClient } from "../shared";
import { discoverySchema, OpenIdVerifier } from "./oidc";

export type IdentityProfile = {
  readonly id: string; readonly label: string; readonly issuer: string;
  readonly protocol: "oidc" | "github"; readonly scopes: readonly string[];
  readonly pkce: boolean;
};
export const identityProfiles: readonly IdentityProfile[] = [
  { id: "google", label: "Google", issuer: "https://accounts.google.com", protocol: "oidc", scopes: ["openid", "email", "profile"], pkce: true },
  { id: "github", label: "GitHub", issuer: "https://github.com", protocol: "github", scopes: ["read:user", "user:email"], pkce: true },
  { id: "orcid", label: "ORCID", issuer: "https://orcid.org", protocol: "oidc", scopes: ["openid"], pkce: false },
];
const credentialsSchema = z.strictObject({ clientId: z.string().min(1), clientSecret: z.string().min(1) });
export function identityDefinition(profile: IdentityProfile): AdapterDefinition {
  return {
    kind: `identity-${profile.id}`, label: `${profile.label} sign-in`,
    configuration(settings) {
      const missing: string[] = [];
      if (settings.baseUrl !== profile.issuer) missing.push(`baseUrl ${profile.issuer}`);
      try {
        const parsed = credentialsSchema.safeParse(JSON.parse(settings.secret ?? "{}"));
        if (!parsed.success) missing.push("encrypted secret JSON with clientId and clientSecret from registered OAuth application");
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        missing.push("valid encrypted OAuth credential JSON");
      }
      return missing;
    },
    actions: {},
    async test() { throw new ServiceError("IDENTITY_CONNECTION_DENIED", 422, "Use account sign-in or linking, not connection grants"); },
  };
}
export const identityContributions: readonly AdapterContribution[] = identityProfiles.map((profile) => () => identityDefinition(profile));
export type IdentityConfiguration = {
  readonly profile: IdentityProfile; readonly clientId: string; readonly clientSecret: string;
  readonly authorizationUrl: string; readonly tokenUrl: string; readonly jwksUri: string | null;
  readonly version: number;
};
const tokenSchema = z.object({
  access_token: z.string().min(1), token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  id_token: z.string().optional(), scope: z.string().optional(),
});
export class IdentityProtocol {
  private readonly verifier: OpenIdVerifier;
  constructor(private readonly http: SafeHttpClient, clock: Clock) { this.verifier = new OpenIdVerifier(http, clock); }
  async configure(profile: IdentityProfile, settings: ProviderSettings): Promise<IdentityConfiguration> {
    const capability = configurationCapability(identityDefinition(profile), settings);
    if (!capability.enabled) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, capability.reason ?? "Identity provider disabled");
    const credentials = credentialsSchema.parse(JSON.parse(settings.secret ?? "{}"));
    switch (profile.protocol) {
      case "github":
        return { profile, ...credentials, authorizationUrl: `${profile.issuer}/login/oauth/authorize`,
          tokenUrl: `${profile.issuer}/login/oauth/access_token`, jwksUri: null, version: settings.version };
      case "oidc": {
        const metadata = await this.http.json(`${profile.issuer}/.well-known/openid-configuration`, discoverySchema, { maxBytes: 64 * 1024 });
        if (metadata.issuer !== profile.issuer || !metadata.response_types_supported.includes("code") ||
          !metadata.id_token_signing_alg_values_supported.includes("RS256") ||
          (profile.pkce && !metadata.code_challenge_methods_supported?.includes("S256"))) {
          throw new ServiceError("OIDC_DISCOVERY_INVALID", 503, "Discovery issuer or required authorization contract does not match");
        }
        for (const url of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) await this.http.validate(url, true);
        return { profile, ...credentials, authorizationUrl: metadata.authorization_endpoint,
          tokenUrl: metadata.token_endpoint, jwksUri: metadata.jwks_uri, version: settings.version };
      }
      default: return assertNever(profile.protocol);
    }
  }
  async exchange(config: IdentityConfiguration, input: {
    readonly code: string; readonly redirectUri: string; readonly verifier: string; readonly nonce: string;
  }) {
    const fields = new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret,
      grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri,
      ...(config.profile.pkce ? { code_verifier: input.verifier } : {}),
    });
    const tokens = await this.http.json(config.tokenUrl, tokenSchema, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: fields.toString(), maxBytes: 64 * 1024,
    });
    switch (config.profile.protocol) {
      case "github": {
        const granted = tokens.scope?.split(/[ ,]+/) ?? [];
        if (!granted.includes("user:email") && !granted.includes("user")) {
          throw new ServiceError("OAUTH_SCOPE_INVALID", 403, "GitHub verified-email scope was not granted");
        }
        const api = config.profile.issuer === "https://github.com" ? "https://api.github.com" : config.profile.issuer;
        const headers = { authorization: `Bearer ${tokens.access_token}`, accept: "application/vnd.github+json",
          "user-agent": "Quire-Identity", "x-github-api-version": "2022-11-28" };
        const user = await this.http.json(`${api}/user`, z.object({
          id: z.int().positive(), login: z.string().min(1), name: z.string().nullable(),
        }), { headers, maxBytes: 64 * 1024 });
        const emails = await this.http.json(`${api}/user/emails?per_page=100`, z.array(z.object({
          email: z.email(), primary: z.boolean(), verified: z.boolean(),
        })), { headers, maxBytes: 128 * 1024 });
        return { issuer: config.profile.issuer, subject: String(user.id), name: user.name ?? user.login,
          verifiedEmail: emails.find((email) => email.primary && email.verified)?.email ?? null };
      }
      case "oidc": {
        if (!tokens.id_token || !config.jwksUri) throw new ServiceError("OIDC_TOKEN_REQUIRED", 403, "Provider did not issue an ID token");
        const claims = await this.verifier.verify(tokens.id_token, {
          issuer: config.profile.issuer, clientId: config.clientId, nonce: input.nonce,
          jwksUri: config.jwksUri, accessToken: tokens.access_token,
        });
        return { issuer: config.profile.issuer, subject: claims.sub, name: claims.name ?? claims.sub,
          verifiedEmail: claims.email_verified === true ? claims.email ?? null : null };
      }
      default: return assertNever(config.profile.protocol);
    }
  }
}
