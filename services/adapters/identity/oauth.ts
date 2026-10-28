import { createHash } from "node:crypto";
import { configurationCapability, ProviderConfigurations } from "../shared";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { authentication } from "../../accounts/identity/authentication";
import { store } from "../../accounts/identity/store";
import { identityPolicy } from "../../accounts/identity/reads";
import type { SafeHttpClient } from "../shared";
import { createExternalIdentityAdmission } from "./admission";
import type { ExternalIdentityVerification } from "./admission";
import { IdentityProtocol, identityDefinition } from "./providers";
import type { IdentityProfile } from "./providers";
import { IdentityStates } from "./state";
import type { IdentityProvider } from "./registry";

export function oauthIdentityProvider(context: ModuleContext, profile: IdentityProfile, http: SafeHttpClient): IdentityProvider {
  const configuration = new ProviderConfigurations(context, http);
  const definition = identityDefinition(profile);
  const protocol = new IdentityProtocol(http, context.clock);
  const states = new IdentityStates(context);
  const repository = store(context);
  const auth = authentication(context, repository);
  async function start(request: RequestContext, input: {
    readonly returnTo: string; readonly link?: ExternalIdentityVerification["link"];
  }) {
    if ((await identityPolicy(context)).requireSso) throw new ServiceError("SSO_REQUIRED", 403, "Use the institutional identity provider");
    const config = await protocol.configure(profile, await configuration.get(definition.kind));
    await http.validate(config.authorizationUrl, true);
    const state = await states.create(request, { provider: profile.id, version: config.version, ...input });
    const url = new URL(config.authorizationUrl);
    for (const [key, value] of Object.entries({
      client_id: config.clientId, response_type: "code", scope: profile.scopes.join(" "),
      redirect_uri: state.redirectUri, state: state.state, nonce: state.nonce,
      ...(profile.pkce ? { code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(state.verifier).digest("base64url") } : {}),
    })) url.searchParams.set(key, value);
    request.responseHeaders.set("location", url.href);
    return new Response(null, { status: 302, headers: request.responseHeaders });
  }
  return {
    id: profile.id, label: profile.label,
    read: async () => {
      const capability = configurationCapability(definition, await configuration.get(definition.kind));
      if (capability.enabled && (await identityPolicy(context)).requireSso) {
        return { enabled: false, state: "disabled", reason: "Institutional single sign-on is required" };
      }
      return capability;
    },
    start: (request, returnTo) => start(request, { returnTo }),
    async link(request, expectedVersion) {
      const principal = await auth.mutation(request.request);
      await auth.fresh(principal);
      await start(request, { returnTo: "/settings/identities",
        link: { userId: principal.user.id, sessionId: principal.sessionId, expectedVersion } });
      return expectedVersion;
    },
    async callback(request) {
      const query = new URL(request.request.url).searchParams;
      for (const name of ["code", "state", "error", "iss"]) {
        if (query.getAll(name).length > 1) throw new ServiceError("OAUTH_CALLBACK_INVALID", 400, "Duplicate callback parameter");
      }
      const settings = await configuration.get(definition.kind);
      const state = await states.consume(request, { provider: profile.id, state: query.get("state") ?? "", version: settings.version });
      if (query.has("error")) throw new ServiceError("OAUTH_DENIED", 400, "Provider denied authorization");
      const code = query.get("code");
      if (!code) throw new ServiceError("OAUTH_CODE_REQUIRED", 400, "Authorization code required");
      if (query.has("iss") && query.get("iss") !== profile.issuer) {
        throw new ServiceError("OIDC_ISSUER_INVALID", 403, "Callback issuer does not match provider");
      }
      const config = await protocol.configure(profile, settings);
      const admit = createExternalIdentityAdmission(context, { kind: "oauth",
        async verify(authorizationCode: string) {
          const identity = await protocol.exchange(config, {
            code: authorizationCode, redirectUri: state.redirect_uri, verifier: state.verifier, nonce: state.nonce,
          });
          return { ...identity, allowCreate: true,
            ...(state.user_id && state.session_id && state.account_version !== null ? {
              link: { userId: state.user_id, sessionId: state.session_id, expectedVersion: state.account_version },
            } : {}),
            beforeCommit: async (tx) => {
              const current = await configuration.get(definition.kind, tx);
              if (current.version !== settings.version || !configurationCapability(definition, current).enabled) {
                throw new ServiceError("PROVIDER_CHANGED", 409, "Identity provider configuration changed during verification");
              }
            },
          } satisfies ExternalIdentityVerification;
        },
      });
      await admit(code, request);
      request.responseHeaders.set("location", state.return_to);
      return new Response(null, { status: 303, headers: request.responseHeaders });
    },
  };
}
