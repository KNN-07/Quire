import { z } from "zod";
import { endpoints, LinkedIdentitySchema, resourceVersionTag } from "@quire/contracts";
import type { Capability } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { IdentityDependencies } from "./credentials";

export type AuthProviderCapability = {
  readonly id: string;
  readonly label: string;
  readonly read: () => Capability;
};
const providers = new WeakMap<ModuleContext["services"], Map<string, AuthProviderCapability>>();

/** An adapter supplies its actual availability reader; this does not install a login handler. */
export function registerAuthProviderCapability(
  context: Pick<ModuleContext, "services">, provider: AuthProviderCapability,
): void {
  const registered = providers.get(context.services) ?? new Map<string, AuthProviderCapability>();
  if (registered.has(provider.id)) throw new ServiceError("DUPLICATE_AUTH_PROVIDER", 500, "Authentication provider already registered");
  registered.set(provider.id, provider);
  providers.set(context.services, registered);
}

export function registerReads(context: ModuleContext, dependencies: IdentityDependencies): void {
  const { routes, db } = context;
  const { auth, repository } = dependencies;
  routes.register(endpoints.authOptions, () => ({
    passwordEnabled: true, registrationEnabled: true,
    providers: [...providers.get(context.services)?.values() ?? []]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((provider) => ({ id: provider.id, label: provider.label, capability: provider.read() })),
  }));
  routes.register(endpoints.identitiesList, async ({ query }, request) => {
    const principal = await auth.port.require(request.request);
    const rows = z.array(z.object({
      id: z.string(), issuer: z.string(), subject: z.string(), created_at: z.string(),
    })).parse(db.query("SELECT id,issuer,subject,created_at FROM identities WHERE user_id=? AND id>? ORDER BY id LIMIT ?")
      .all(principal.user.id, query.cursor ?? "", query.limit + 1));
    const page = rows.slice(0, query.limit);
    request.responseHeaders.set("etag", resourceVersionTag(repository.find(principal.user.id).version));
    return {
      items: page.map((row) => LinkedIdentitySchema.parse({
        id: row.id, issuer: row.issuer, subject: row.subject, createdAt: row.created_at,
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null,
    };
  });
}
