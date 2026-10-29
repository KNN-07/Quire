import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { RequestContext, ServiceModule } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { registerAuthProviderCapability, registerAuthDiscovery, registerIdentityPolicy } from "../../accounts/identity";
import { requireOrigin } from "../../accounts/identity/authentication";
import { store } from "../../accounts/identity/store";
import { createExternalIdentityAdmission, registerIdentityProvider } from "../identity";
import { SafeHttpClient } from "../shared";
import { FederationConfigurations } from "./configuration";
import type { FederationDeployment } from "./configuration";
import { FederationProvisioning } from "./provisioning";
import { oidcProvider, selected } from "./oidc";
import type { FederationServices } from "./oidc";
import { samlProvider } from "./saml-provider";
import { FederationLdap } from "./ldap";
import { enrollFederationBreakGlass, registerAdministration, rotateFederationCertificates } from "./admin";
import { ScimStore } from "./scim-store";
import { registerScim } from "./scim-routes";
import { migrations } from "./migrations";
import { returnPath } from "../identity/state";
import { FederationHandshakeTests } from "./handshake-tests";
import { registerManagedReleaseAuthority } from "../../accounts/identity/managed-release";

export function createFederationModules(options: FederationDeployment & { readonly http?: SafeHttpClient } = {}) {
  let services: FederationServices | undefined;
  let tests: FederationHandshakeTests | undefined;
  const callbacks: ServiceModule = {
    id: "066-a-federation", lane: "A", order: 66, migrations,
    register(context) {
      if (services) throw new ServiceError("DUPLICATE_FEDERATION", 500, "Create fresh federation modules for each runtime");
      const configurations = new FederationConfigurations(context, options);
      registerAuthDiscovery(context, async domain => {
        const settings = await configurations.get();
        if (!options.organizationId || !settings.config.domains.some(value => value.toLowerCase() === domain))
          return { organizations: [] };
        const row = await context.db.get("SELECT id,name FROM organizations WHERE id=?", [options.organizationId]);
        if (!row) return { organizations: [] };
        const organization = z.object({ id: IdSchema, name: z.string() }).parse(row);
        return { organizations: [{ ...organization, provider: settings.config.protocol,
          capability: configurations.capability(settings) }] };
      });
      const provisioning = new FederationProvisioning(context, options);
      if (options.organizationId) registerManagedReleaseAuthority(context, {
        organizationId: options.organizationId,
        release: (tx, input) => provisioning.release(tx, input.userId),
      });
      const http = options.http ?? new SafeHttpClient();
      services = { context, configurations, provisioning, http };
      tests = new FederationHandshakeTests(services);
      registerIdentityPolicy(context, async (executor) => {
        const { config } = await configurations.get(executor);
        return { requireSso: config.enabled && config.requireSso, breakGlassUserId: config.breakGlassUserId };
      });
      registerIdentityProvider(context, oidcProvider(services));
      const registered = services;
      registerAuthProviderCapability(context, { id: "ldap", label: "Institutional directory",
        async read() {
          const settings = await configurations.get();
          return settings.config.protocol === "ldap" ? configurations.capability(settings)
            : { enabled: false, state: "disabled", reason: "LDAP is not selected" };
        } });
      context.routes.register(endpoints.ldapLogin, ({ body }, request) => authenticateLdap(registered, request, body));
      registerIdentityProvider(context, tests.provider());
      const saml = samlProvider(services, tests);
      registerIdentityProvider(context, saml.provider);
      context.routes.registerTransport(endpoints.samlCallback, saml.acs);
      registerScim(context, new ScimStore(context, configurations, provisioning));
    },
  };
  const administration: ServiceModule = {
    id: "067-o-federation-admin", lane: endpoints.identityConfigGet.lane, order: 67,
    register(context) {
      if (!services || !tests) throw new ServiceError("FEDERATION_ORDER_INVALID", 500, "Register federation callbacks before administration");
      registerAdministration({ ...services, context }, tests);
      const registered = { ...services, context };
      context.routes.register(endpoints.identityBreakGlass, ({ body }, request) => enrollFederationBreakGlass(context, request, body.password));
      context.routes.register(endpoints.identityCertificates, ({ body }, request) => rotateFederationCertificates(registered, request, body));
    },
  };
  return { callbacks, administration };
}
export async function authenticateLdap(services: FederationServices, request: RequestContext, input: {
  readonly username: string; readonly password: string; readonly returnTo: string;
}) {
  requireOrigin(services.context, request.request);
  returnPath(input.returnTo, services.context.config.publicUrl);
  await store(services.context).limit("ldap-login", input.username.toLowerCase());
  const settings = await services.configurations.get();
  selected(settings.config, "ldap");
  const admit = createExternalIdentityAdmission(services.context, { kind: "federation",
    async verify(credentials: { readonly username: string; readonly password: string }) {
      const identity = await new FederationLdap(services.configurations.deployment).verify(settings, credentials);
      return { issuer: identity.issuer, subject: identity.subject, name: identity.name, verifiedEmail: identity.email,
        allowCreate: settings.config.createOnLogin,
        ...(services.configurations.deployment.organizationId ? { organizationId: services.configurations.deployment.organizationId } : {}),
        async beforeCommit(tx, userId) {
          await services.configurations.fence(tx, settings.config);
          await services.provisioning.apply(tx, { userId, config: settings.config, groups: identity.groups });
        } };
    } });
  return admit(input, request);
}
export { migrations } from "./migrations";
export { FederationConfigurations, emptyConfig } from "./configuration";
export type { FederationDeployment, FederationConfiguration } from "./configuration";
export { FederationOidc } from "./oidc";
export { FederationSaml } from "./saml";
export { FederationLdap } from "./ldap";
export { groupCeiling, FederationProvisioning } from "./provisioning";
export { enrollFederationBreakGlass, rotateFederationCertificates } from "./admin";
