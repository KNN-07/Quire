import { ServiceError } from "@quire/runtime";
import type { ServiceModule } from "@quire/runtime";
import type { AdapterContribution, AdapterServices } from "./contracts";
import { ProviderConfigurations } from "./configuration";
import { GrantStore } from "./grants";
import { AdapterOperations } from "./operations";
import { SafeHttpClient } from "./http";
import { ConfiguredAdapter } from "./configured-adapter";
import { registerConnections } from "./connection-routes";
import { registerProviders } from "./provider-routes";
import { migrations } from "./migrations";

export function createAdapterModules(options: {
  readonly contributions: readonly AdapterContribution[]; readonly http?: SafeHttpClient;
}): { readonly connections: ServiceModule; readonly providers: ServiceModule; readonly close: () => Promise<void> } {
  let services: AdapterServices | undefined;
  const adapters = new Map<string, ConfiguredAdapter>();
  const connections: ServiceModule = {
    id: "060-x-shared-adapters", lane: "X", order: 60, migrations,
    async register(context) {
      if (services) throw new ServiceError("DUPLICATE_ADAPTER_ASSEMBLY", 500, "Create fresh modules for each runtime");
      const http = options.http ?? new SafeHttpClient();
      const configuration = new ProviderConfigurations(context, http);
      const grants = new GrantStore(context);
      const operations = new AdapterOperations({ context, configuration, grants });
      services = { context, http, configuration, grants, operations };
      for (const contribute of options.contributions) {
        const definition = contribute(services);
        if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(definition.kind) || adapters.has(definition.kind)) {
          throw new ServiceError("DUPLICATE_ADAPTER", 500, "Provider kind is invalid or duplicated");
        }
        adapters.set(definition.kind, new ConfiguredAdapter(definition, services, await configuration.get(definition.kind)));
      }
      context.services.provide("adapters", adapters);
      registerConnections(context, services, adapters);
    },
  };
  const providers: ServiceModule = {
    id: "061-o-adapter-providers", lane: "O", order: 61,
    register(context) {
      if (!services) throw new ServiceError("ADAPTER_ORDER_INVALID", 500, "Connections module must register before providers");
      registerProviders(context, services, adapters);
    },
  };
  return { connections, providers, async close() {
    await services?.operations.close();
    for (const adapter of adapters.values()) await adapter.definition.close?.();
  } };
}
export { defineAction, configurationCapability, GrantTokensSchema } from "./contracts";
export type {
  AdapterContribution, AdapterDefinition, AdapterServices, AdapterActionDefinition, ActionContext,
  GrantContext, GrantTokens, OAuthConfiguration, PreparedAction, ProviderSettings,
} from "./contracts";
export { SafeHttpClient } from "./http";
export type { HttpRequest, HttpResponse, HttpPolicy, DnsResolver } from "./http";
export { ConfiguredAdapter } from "./configured-adapter";
export { ProviderConfigurations } from "./configuration";
export { GrantStore } from "./grants";
export { AdapterOperations } from "./operations";
export type { ExecuteAction } from "./operations";
export { migrations } from "./migrations";
