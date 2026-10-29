import type { Id, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

type ReleaseInput = { readonly userId: Id; readonly organizationId: Id };
type ReleaseAuthority = {
  readonly organizationId: Id;
  readonly release: (tx: Transaction, input: ReleaseInput) => Promise<void>;
};
const authorities = new WeakMap<ModuleContext["services"], ReleaseAuthority>();

/** Optional federation adapter, bound to its assembly organization, never an HTTP-supplied issuer. */
export function registerManagedReleaseAuthority(context: Pick<ModuleContext, "services">, authority: ReleaseAuthority): void {
  if (authorities.has(context.services)) throw new ServiceError("DUPLICATE_RELEASE_AUTHORITY", 500, "Release authority already registered");
  authorities.set(context.services, authority);
}

export async function releaseIdentityAuthority(context: ModuleContext, tx: Transaction, input: ReleaseInput): Promise<void> {
  const authority = authorities.get(context.services);
  if (authority?.organizationId !== input.organizationId && await tx.get(
    "SELECT id FROM identities WHERE user_id=? AND authority_kind='organization' AND organization_id=?",
    [input.userId, input.organizationId])) {
    throw new ServiceError("RELEASE_AUTHORITY_UNAVAILABLE", 409, "Load this organization's federation adapter before release");
  }
  // A stored federation ceiling without its adapter cannot be safely attributed or reconciled.
  if (!authority && await tx.get("SELECT id FROM policy_sets WHERE scope_kind='federation-user' AND scope_id=?", [input.userId])) {
    throw new ServiceError("RELEASE_AUTHORITY_UNAVAILABLE", 409, "Load the federation adapter before releasing this account");
  }
  if (authority?.organizationId === input.organizationId) await authority.release(tx, input);
  await tx.run("INSERT INTO identity_organization_releases(user_id,organization_id) VALUES(?,?) ON CONFLICT DO NOTHING",
    [input.userId, input.organizationId]);
  await tx.run("DELETE FROM identities WHERE user_id=? AND authority_kind='organization' AND organization_id=?",
    [input.userId, input.organizationId]);
}

export async function requireOrganizationIdentityAuthority(tx: Transaction, input: ReleaseInput): Promise<void> {
  if (await tx.get("SELECT user_id FROM identity_organization_releases WHERE user_id=? AND organization_id=?",
    [input.userId, input.organizationId])) {
    throw new ServiceError("MANAGED_RELEASED", 409, "Released accounts require independent account controls");
  }
}
