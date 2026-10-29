import { endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { AdapterServices } from "./contracts";
import type { ConfiguredAdapter } from "./configured-adapter";
import { AiOperatorPolicies } from "./provider-policy";

export function registerProviders(context: ModuleContext, services: AdapterServices, adapters: ReadonlyMap<string, ConfiguredAdapter>): void {
  const identity = context.services.get("identity");
  const policies = new AiOperatorPolicies(context);
  context.routes.register(endpoints.providerAiPolicyGet, async (_input, request) => {
    const principal = await identity.require(request.request);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator required");
    const policy = await policies.get();
    request.responseHeaders.set("etag", `"${policy.version}"`);
    return policy;
  });
  context.routes.register(endpoints.providerAiPolicyPut, async (input, request) => {
    const principal = await identity.require(request.request);
    await identity.verifyMutation(request.request, principal);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator required");
    if (request.request.headers.get("if-match") !== `"${input.body.expectedVersion}"`) {
      throw new ServiceError("VERSION_CONFLICT", 409, "If-Match must match expectedVersion");
    }
    const policy = await policies.put(principal.user.id, input.body);
    request.responseHeaders.set("etag", `"${policy.version}"`);
    return policy;
  });
  const find = (kind: string) => {
    const adapter = adapters.get(kind);
    if (!adapter) throw new ServiceError("PROVIDER_UNKNOWN", 404, "Provider is not installed");
    return adapter;
  };
  context.routes.register(endpoints.providerGet, async (input, request) => {
    const principal = await identity.require(request.request);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator required");
    const adapter = find(input.params.kind);
    const settings = await services.configuration.get(input.params.kind);
    request.responseHeaders.set("etag", `"${settings.version}"`);
    return services.configuration.describe(adapter.definition, settings);
  });
  context.routes.register(endpoints.providerPut, async (input, request) => {
    const principal = await identity.require(request.request);
    await identity.verifyMutation(request.request, principal);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator required");
    if (request.request.headers.get("if-match") !== `"${input.body.expectedVersion}"`) {
      throw new ServiceError("VERSION_CONFLICT", 409, "If-Match must match expectedVersion");
    }
    const adapter = find(input.params.kind);
    const settings = await services.configuration.put({ ...input.body, kind: input.params.kind, actorId: principal.user.id });
    await adapter.availability();
    request.responseHeaders.set("etag", `"${settings.version}"`);
    return services.configuration.describe(adapter.definition, settings);
  });
  context.routes.register(endpoints.providerTest, async (input, request) => {
    const principal = await identity.require(request.request);
    await identity.verifyMutation(request.request, principal);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator required");
    const adapter = find(input.params.kind);
    const settings = await services.configuration.get(input.params.kind);
    if (settings.version !== input.body.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Provider configuration changed");
    const capability = await adapter.availability();
    if (!capability.enabled) return { ok: false, reason: capability.reason ?? "Provider unavailable" };
    if (!adapter.definition.probe) return { ok: false, reason: "Provider requires a user-owned connection test" };
    return adapter.definition.probe(settings);
  });
}
