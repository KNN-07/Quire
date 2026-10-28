import { endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { registerAuthProviderCapability } from "../../accounts/identity";
import type { AuthProviderCapability } from "../../accounts/identity";

export type IdentityProvider = AuthProviderCapability & {
  readonly start: (request: RequestContext, returnTo: string) => Promise<Response>;
  readonly callback: (request: RequestContext) => Promise<Response>;
  readonly link: (request: RequestContext, expectedVersion: number) => Promise<number>;
};
const registry = new WeakMap<ModuleContext["services"], Map<string, IdentityProvider>>();
export function registerIdentityProvider(context: ModuleContext, provider: IdentityProvider): void {
  const providers = registry.get(context.services) ?? new Map<string, IdentityProvider>();
  if (!/^[a-z][a-z0-9-]*$/.test(provider.id) || providers.has(provider.id)) {
    throw new ServiceError("DUPLICATE_IDENTITY_PROVIDER", 500, "Invalid or duplicate identity provider");
  }
  registerAuthProviderCapability(context, provider);
  providers.set(provider.id, provider);
  registry.set(context.services, providers);
}
export function registerIdentityRoutes(context: ModuleContext): void {
  function provider(request: RequestContext) {
    const id = new URL(request.request.url).pathname.split("/")[3];
    const found = id ? registry.get(context.services)?.get(id) : undefined;
    if (!found) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Identity provider is not installed");
    return found;
  }
  context.routes.registerTransport(endpoints.identityStart, (request) =>
    provider(request).start(request, new URL(request.request.url).searchParams.get("returnTo") ?? "/projects"));
  context.routes.registerTransport(endpoints.identityCallback, (request) => provider(request).callback(request));
  context.routes.register(endpoints.identityLink, async ({ params, body }, request) => {
    const found = registry.get(context.services)?.get(params.provider);
    if (!found) throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Identity provider is not installed");
    const version = await found.link(request, body.expectedVersion);
    return { ok: true as const, version };
  });
}
