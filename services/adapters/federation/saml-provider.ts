import { ServiceError } from "@quire/runtime";
import type { RequestContext } from "@quire/runtime";
import { createExternalIdentityAdmission } from "../identity";
import type { ExternalIdentityVerification, IdentityProvider } from "../identity";
import { IdentityStates } from "../identity/state";
import { authentication } from "../../accounts/identity/authentication";
import { store } from "../../accounts/identity/store";
import { FederationSaml } from "./saml";
import { redirect, selected } from "./oidc";
import type { FederationServices } from "./oidc";
import type { FederationHandshakeTests } from "./handshake-tests";

export function samlProvider(services: FederationServices, tests?: FederationHandshakeTests) {
  const { context, configurations, provisioning, http } = services;
  const protocol = new FederationSaml(context);
  const states = new IdentityStates(context);
  const auth = authentication(context, store(context));
  async function start(request: RequestContext, input: {
    readonly returnTo: string; readonly link?: ExternalIdentityVerification["link"];
  }) {
    const settings = await configurations.get();
    selected(settings.config, "saml");
    if (!configurations.capability(settings).enabled) throw new ServiceError("SAML_UNCONFIGURED", 503, configurations.capability(settings).reason ?? "SAML is unconfigured");
    await http.validate(settings.config.saml?.ssoUrl ?? "", true);
    const state = await states.create(request, { provider: "saml", version: settings.config.version, ...input });
    // A cross-site IdP POST cannot carry a SameSite=Lax cookie. Production TLS uses None+Secure.
    if (new URL(context.config.publicUrl).protocol === "https:") {
      const cookies = request.responseHeaders.getSetCookie();
      request.responseHeaders.delete("set-cookie");
      for (const cookie of cookies) request.responseHeaders.append("set-cookie", cookie.replace("SameSite=Lax", "SameSite=None"));
    }
    const destination = await protocol.client(settings.config).getAuthorizeUrlAsync(state.state, undefined, {});
    return redirect(request, destination, 302);
  }
  const provider: IdentityProvider = {
    id: "saml", label: "Institutional SAML",
    async read() { const value = await configurations.get(); return value.config.protocol === "saml"
      ? configurations.capability(value) : { enabled: false, state: "disabled", reason: "SAML is not selected" }; },
    start: (request, returnTo) => start(request, { returnTo }),
    async link(request, expectedVersion) {
      const principal = await auth.mutation(request.request);
      await auth.fresh(principal);
      await start(request, { returnTo: "/settings/identities", link: { userId: principal.user.id, sessionId: principal.sessionId, expectedVersion } });
      return expectedVersion;
    },
    async callback() { throw new ServiceError("SAML_POST_REQUIRED", 405, "Use POST /api/auth/saml/acs"); },
  };
  async function acs(request: RequestContext) {
    const settings = await configurations.get();
    const contentLength = Number(request.request.headers.get("content-length") ?? "0");
    if (contentLength > 1500_000) throw new ServiceError("SAML_TOO_LARGE", 413, "SAML form exceeds limit");
    const bytes = await request.request.arrayBuffer();
    if (bytes.byteLength > 1500_000) throw new ServiceError("SAML_TOO_LARGE", 413, "SAML form exceeds limit");
    if (!(request.request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) {
      throw new ServiceError("SAML_BINDING_INVALID", 400, "SAML HTTP-POST form binding required");
    }
    const form = new URLSearchParams(new TextDecoder().decode(bytes));
    if (form.getAll("RelayState").length !== 1 || form.getAll("SAMLResponse").length !== 1) {
      throw new ServiceError("SAML_BINDING_INVALID", 400, "Exactly one RelayState and SAMLResponse required");
    }
    const relayState = form.get("RelayState") ?? "";
    if (tests && await tests.owns(relayState)) return tests.complete(request, {
      state: relayState, samlResponse: form.get("SAMLResponse") ?? "",
    });
    selected(settings.config, "saml");
    const state = await states.consume(request, { provider: "saml", state: form.get("RelayState") ?? "", version: settings.config.version });
    const admit = createExternalIdentityAdmission(context, { kind: "federation",
      async verify(encoded: string) {
        const identity = await protocol.verify(settings.config, encoded);
        return { issuer: identity.issuer, subject: identity.subject, name: identity.name, verifiedEmail: identity.email,
          allowCreate: settings.config.createOnLogin,
          ...(configurations.deployment.organizationId ? { organizationId: configurations.deployment.organizationId } : {}),
          ...(state.user_id && state.session_id && state.account_version !== null ? {
            link: { userId: state.user_id, sessionId: state.session_id, expectedVersion: state.account_version } } : {}),
          async beforeCommit(tx, userId) {
            await configurations.fence(tx, settings.config);
            await identity.publish(tx);
            await provisioning.apply(tx, { userId, config: settings.config, groups: identity.groups });
          } };
      } });
    await admit(form.get("SAMLResponse") ?? "", request);
    return redirect(request, state.return_to);
  }
  return { provider, acs, protocol };
}
