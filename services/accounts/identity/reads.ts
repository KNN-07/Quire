import { z } from "zod";
import { endpoints, LinkedIdentitySchema, resourceVersionTag } from "@quire/contracts";
import type { Capability, Id, SqlExecutor } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { IdentityDependencies } from "./credentials";

export type AuthProviderCapability = {
  readonly id: string;
  readonly label: string;
  readonly read: () => Capability | Promise<Capability>;
};
const providers = new WeakMap<ModuleContext["services"], Map<string, AuthProviderCapability>>();
type DiscoveryReader = (domain: string) => Promise<z.infer<typeof endpoints.authDiscover.output>>;
const discovery = new WeakMap<ModuleContext["services"], DiscoveryReader>();
export function registerAuthDiscovery(context: Pick<ModuleContext, "services">, reader: DiscoveryReader): void {
  if (discovery.has(context.services)) throw new ServiceError("DUPLICATE_AUTH_DISCOVERY", 500, "Authentication discovery already registered");
  discovery.set(context.services, reader);
}
export type IdentityPolicy = {
  readonly requireSso: boolean;
  readonly breakGlassUserId: Id | null;
};
const policies = new WeakMap<ModuleContext["services"], (executor: SqlExecutor) => Promise<IdentityPolicy>>();

export function registerIdentityPolicy(
  context: Pick<ModuleContext, "services">,
  read: (executor: SqlExecutor) => Promise<IdentityPolicy>,
): void {
  if (policies.has(context.services)) throw new ServiceError("DUPLICATE_IDENTITY_POLICY", 500, "Identity policy already registered");
  policies.set(context.services, read);
}

export async function identityPolicy(context: ModuleContext, executor: SqlExecutor = context.db): Promise<IdentityPolicy> {
  return policies.get(context.services)?.(executor) ?? { requireSso: false, breakGlassUserId: null };
}

export async function requireEnrolledBreakGlass(context: ModuleContext, userId: Id, executor: SqlExecutor = context.db): Promise<void> {
  const enrolled = await executor.get(`SELECT u.id FROM users u JOIN identity_breakglass b ON b.user_id=u.id
    WHERE u.id=? AND u.operator=1 AND u.suspended=0 AND u.deleted_at IS NULL AND u.password_hash IS NOT NULL
    AND EXISTS(SELECT 1 FROM verified_emails e WHERE e.user_id=u.id AND lower(e.email)=lower(u.primary_email))`, [userId]);
  if (!enrolled) throw new ServiceError("BREAKGLASS_ENROLLMENT_REQUIRED", 403, "Enroll an active operator with a verified email and password");
}

export async function passwordAllowed(context: ModuleContext, userId: Id, executor: SqlExecutor = context.db): Promise<boolean> {
  const policy = await identityPolicy(context, executor);
  if (!policy.requireSso) return true;
  if (policy.breakGlassUserId !== userId) return false;
  await requireEnrolledBreakGlass(context, userId, executor);
  return true;
}

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
  routes.register(endpoints.authDiscover, async ({ query }, request) => {
    request.responseHeaders.set("cache-control", "no-store");
    return await discovery.get(context.services)?.(query.domain) ?? { organizations: [] };
  });
  routes.register(endpoints.authOptions, async () => {
    const policy = await identityPolicy(context);
    return {
      passwordEnabled: !policy.requireSso, registrationEnabled: !policy.requireSso,
      providers: await Promise.all([...providers.get(context.services)?.values() ?? []]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(async (provider) => ({ id: provider.id, label: provider.label, capability: await provider.read() }))),
    };
  });
  routes.register(endpoints.identitiesList, async ({ query }, request) => {
    const principal = await auth.port.require(request.request);
    const rows = z.array(z.object({
      id: z.string(), issuer: z.string(), subject: z.string(), created_at: z.string(),
    })).parse((await db.all("SELECT id,issuer,subject,created_at FROM identities WHERE user_id=? AND id>? ORDER BY id LIMIT ?", [principal.user.id, query.cursor ?? "", query.limit + 1])));
    const page = rows.slice(0, query.limit);
    request.responseHeaders.set("etag", resourceVersionTag((await repository.find(principal.user.id)).version));
    return {
      items: page.map((row) => LinkedIdentitySchema.parse({
        id: row.id, issuer: row.issuer, subject: row.subject, createdAt: row.created_at,
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null,
    };
  });
}
