import { createHash } from "node:crypto";
import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import type { IdentityConfig } from "@quire/contracts";
import { createExternalIdentityAdmission } from "../identity";
import { IdentityStates } from "../identity/state";
import { discoverySchema, OpenIdVerifier } from "../identity/oidc";
import type { ExternalIdentityVerification, IdentityProvider } from "../identity";
import type { SafeHttpClient } from "../shared";
import { authentication } from "../../accounts/identity/authentication";
import { store } from "../../accounts/identity/store";
import { trustedAttributes } from "./provisioning";
import type { FederationProvisioning } from "./provisioning";
import type { FederationConfiguration, FederationConfigurations } from "./configuration";

export class FederationOidc {
  constructor(private readonly http: SafeHttpClient, private readonly context: ModuleContext) {}
  async discover(settings: FederationConfiguration) {
    const config = settings.config.oidc;
    if (!config || !settings.oidcSecret) throw new ServiceError("OIDC_UNCONFIGURED", 503, "Missing OIDC issuer, clientId or client secret");
    const issuer = new URL(config.issuer);
    if (issuer.search || issuer.hash || issuer.username || issuer.password) throw new ServiceError("OIDC_ISSUER_INVALID", 400, "OIDC issuer must not contain credentials, query or fragment");
    await this.http.validate(issuer.href, true);
    const discovery = await this.http.json(`${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
      discoverySchema.extend({ token_endpoint_auth_methods_supported: z.array(z.string()).optional() }), { maxBytes: 128 * 1024 });
    if (discovery.issuer !== config.issuer || !discovery.response_types_supported.includes("code") ||
      !discovery.id_token_signing_alg_values_supported.includes("RS256") ||
      !discovery.code_challenge_methods_supported?.includes("S256")) {
      throw new ServiceError("OIDC_DISCOVERY_INVALID", 403, "Issuer must advertise code, RS256 and S256 PKCE");
    }
    for (const url of [discovery.authorization_endpoint, discovery.token_endpoint, discovery.jwks_uri]) await this.http.validate(url, true);
    return { discovery, config, secret: settings.oidcSecret };
  }
  async verify(settings: FederationConfiguration, proof: {
    readonly code: string; readonly verifier: string; readonly nonce: string; readonly redirectUri: string;
  }) {
    const { discovery, config, secret } = await this.discover(settings);
    const methods = discovery.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
    const basic = methods.includes("client_secret_basic");
    if (!basic && !methods.includes("client_secret_post")) throw new ServiceError("OIDC_AUTH_METHOD_UNSUPPORTED", 503, "Provider must support client_secret_basic or client_secret_post");
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId,
      code: proof.code, redirect_uri: proof.redirectUri, code_verifier: proof.verifier });
    if (!basic) form.set("client_secret", secret);
    const tokens = await this.http.json(discovery.token_endpoint, z.object({
      access_token: z.string().min(1), id_token: z.string().min(1), token_type: z.string(),
    }), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded",
      ...(basic ? { authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(secret)}`).toString("base64")}` } : {}) },
      body: form.toString(),
      maxBytes: 128 * 1024 });
    const claims = await new OpenIdVerifier(this.http, this.context.clock).verify(tokens.id_token, {
      issuer: config.issuer, clientId: config.clientId, nonce: proof.nonce,
      jwksUri: discovery.jwks_uri, accessToken: tokens.access_token, strictIssuer: true,
    });
    if (claims.iss !== config.issuer || claims.email_verified !== true) {
      throw new ServiceError("OIDC_CLAIMS_INVALID", 403, "Exact issuer and verified email required");
    }
    return { issuer: claims.iss, subject: claims.sub, ...trustedAttributes(settings.config, claims) };
  }
}
export type FederationServices = {
  readonly context: ModuleContext;
  readonly configurations: FederationConfigurations;
  readonly provisioning: FederationProvisioning;
  readonly http: SafeHttpClient;
};
export function oidcProvider(services: FederationServices): IdentityProvider {
  const { context, configurations, provisioning, http } = services;
  const protocol = new FederationOidc(http, context);
  const states = new IdentityStates(context);
  const auth = authentication(context, store(context));
  async function configured() {
    const value = await configurations.get();
    if (value.config.protocol !== "oidc" || !configurations.capability(value).enabled) {
      throw new ServiceError("OIDC_UNCONFIGURED", 503, configurations.capability(value).reason ?? "OIDC is not selected");
    }
    return value;
  }
  async function start(request: RequestContext, input: {
    readonly returnTo: string; readonly link?: ExternalIdentityVerification["link"];
  }) {
    const settings = await configured();
    const { discovery, config } = await protocol.discover(settings);
    const state = await states.create(request, { provider: "oidc", version: settings.config.version, ...input });
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code",
      scope: config.scopes.join(" "), redirect_uri: state.redirectUri, state: state.state, nonce: state.nonce,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(state.verifier).digest("base64url") }).toString();
    return redirect(request, url.href, 302);
  }
  return {
    id: "oidc", label: "Institutional OpenID Connect",
    async read() { const value = await configurations.get(); return value.config.protocol === "oidc"
      ? configurations.capability(value) : { enabled: false, state: "disabled", reason: "OIDC is not selected" }; },
    start: (request, returnTo) => start(request, { returnTo }),
    async link(request, expectedVersion) {
      const principal = await auth.mutation(request.request);
      await auth.fresh(principal);
      await start(request, { returnTo: "/settings/identities", link: { userId: principal.user.id, sessionId: principal.sessionId, expectedVersion } });
      return expectedVersion;
    },
    async callback(request) {
      const settings = await configured();
      const query = new URL(request.request.url).searchParams;
      for (const name of ["state", "code", "iss", "error"]) if (query.getAll(name).length > 1) {
        throw new ServiceError("OIDC_CALLBACK_INVALID", 400, "Duplicate authorization response parameter");
      }
      const state = await states.consume(request, { provider: "oidc", state: query.get("state") ?? "", version: settings.config.version });
      if (query.has("error") || !query.get("code")) throw new ServiceError("OIDC_DENIED", 403, "Authorization code required");
      if (query.has("iss") && query.get("iss") !== settings.config.oidc?.issuer) throw new ServiceError("OIDC_ISSUER_INVALID", 403, "Authorization response issuer mismatch");
      const admit = createExternalIdentityAdmission(context, { kind: "federation",
        async verify(code: string) {
          const identity = await protocol.verify(settings, { code, verifier: state.verifier, nonce: state.nonce, redirectUri: state.redirect_uri });
          return { issuer: identity.issuer, subject: identity.subject, name: identity.name, verifiedEmail: identity.email,
            allowCreate: settings.config.createOnLogin,
            ...(state.user_id && state.session_id && state.account_version !== null ? {
              link: { userId: state.user_id, sessionId: state.session_id, expectedVersion: state.account_version } } : {}),
            async beforeCommit(tx, userId) {
              await configurations.fence(tx, settings.config);
              await provisioning.apply(tx, { userId, config: settings.config, groups: identity.groups });
            } };
        } });
      await admit(query.get("code") ?? "", request);
      return redirect(request, state.return_to);
    },
  };
}
export function redirect(request: RequestContext, destination: string, status = 303): Response {
  request.responseHeaders.set("location", destination);
  return new Response(null, { status, headers: request.responseHeaders });
}
export function selected(config: IdentityConfig, protocol: IdentityConfig["protocol"]): void {
  if (!config.enabled || config.protocol !== protocol) throw new ServiceError("FEDERATION_DISABLED", 503, `${protocol} is disabled`);
}
