import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, IdentityConfig, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { defaultPolicy } from "../../accounts/identity/policy";
import { newId } from "../../accounts/identity/store";
import type { FederationDeployment } from "./configuration";
import { publishPolicyChange } from "../../accounts/governance/shared";

const roleRank = { guest: 0, member: 1, manager: 2, admin: 3 } as const;
const aiRank = { off: 0, ask: 1, agent: 2 } as const;
export function groupCeiling(config: IdentityConfig, groups: readonly string[]) {
  const matched = config.mappings.filter((mapping) => groups.includes(mapping.group));
  const first = matched[0];
  return first ? matched.reduce((ceiling, mapping) => ({
    role: roleRank[mapping.role] < roleRank[ceiling.role] ? mapping.role : ceiling.role,
    ai: aiRank[mapping.ai] < aiRank[ceiling.ai] ? mapping.ai : ceiling.ai,
  }), { role: first.role, ai: first.ai }) : { role: "guest" as const, ai: "off" as const };
}
export function trustedAttributes(config: IdentityConfig, attributes: Readonly<Record<string, unknown>>) {
  const email = z.email().parse(attributes[config.attributes.email]).toLowerCase();
  if (!config.domains.map((domain) => domain.toLowerCase()).includes(email.split("@")[1] ?? "")) {
    throw new ServiceError("FEDERATION_DOMAIN_DENIED", 403, "Identity email domain is outside the configured institution");
  }
  const name = z.string().min(1).max(200).parse(attributes[config.attributes.name]);
  const rawGroups = attributes[config.attributes.groups];
  const groups = rawGroups === undefined ? [] : z.union([z.string(), z.array(z.string())]).parse(rawGroups);
  return { email, name, groups: typeof groups === "string" ? [groups] : groups };
}
export class FederationProvisioning {
  constructor(private readonly context: ModuleContext, private readonly deployment: FederationDeployment) {}
  async apply(tx: Transaction, input: { readonly userId: Id; readonly config: IdentityConfig; readonly groups: readonly string[] }) {
    const organizationId = this.deployment.organizationId;
    if (!organizationId) throw new ServiceError("FEDERATION_UNCONFIGURED", 503, "Missing assembly organizationId");
    await tx.lock("quire:accounts");
    if (input.userId === input.config.breakGlassUserId || await tx.get("SELECT user_id FROM identity_breakglass WHERE user_id=?", [input.userId])) {
      throw new ServiceError("BREAKGLASS_PROTECTED", 403, "Federation cannot provision an enrolled break-glass account");
    }
    const user = z.object({ managed_by: IdSchema.nullable(), suspended: z.number(), deleted_at: z.string().nullable() })
      .parse(await tx.get("SELECT managed_by,suspended,deleted_at FROM users WHERE id=?", [input.userId]));
    if (user.suspended || user.deleted_at) throw new ServiceError("ACCOUNT_DISABLED", 403, "Account is disabled");
    if (user.managed_by && user.managed_by !== organizationId) throw new ServiceError("MANAGED_CONFLICT", 403, "Account belongs to another managed organization");
    const ceiling = groupCeiling(input.config, input.config.enabled ? input.groups : []);
    await tx.run("INSERT INTO federation_claims(user_id,groups_json) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET groups_json=excluded.groups_json",
      [input.userId, JSON.stringify(input.groups)]);
    // Only memberships created by this adapter are reconciled. Never seize manual administration or licensing.
    const owned = await tx.get("SELECT user_id FROM federation_accounts WHERE user_id=?", [input.userId]);
    const membership = await tx.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [organizationId, input.userId]);
    if (owned && ceiling.role !== "admin" && await tx.get(`SELECT id FROM members WHERE organization_id=? AND user_id=? AND role='admin'
      AND NOT EXISTS(SELECT 1 FROM members other WHERE other.organization_id=? AND other.user_id<>? AND other.role='admin')`,
    [organizationId, input.userId, organizationId, input.userId])) {
      throw new ServiceError("LAST_ADMIN", 409, "Reassign organization administration before removing its final administrator");
    }
    if (ceiling.role === "guest") {
      if (owned) await tx.run("DELETE FROM members WHERE organization_id=? AND user_id=?", [organizationId, input.userId]);
    } else if (!membership || owned) {
      await tx.run(`INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,?,0,?)
        ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,version=members.version+1`,
      [newId(), organizationId, input.userId, ceiling.role, this.context.clock.now()]);
      await tx.run("INSERT INTO federation_accounts(user_id,organization_id) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING", [input.userId, organizationId]);
    }
    await tx.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'federation-user',?,?,?)
      ON CONFLICT(scope_kind,scope_id) DO UPDATE SET policy_json=excluded.policy_json,version=policy_sets.version+1,updated_at=excluded.updated_at`,
    [newId(), input.userId, JSON.stringify({ ...defaultPolicy, compileSeconds: 600, ai: ceiling.ai, aiDailyUses: null,
      sharing: "anyone", anonymousRead: true, anonymousEdit: true }), this.context.clock.now()]);
    await this.context.events.record(tx, { topic: "policy.changed", aggregateId: input.userId,
      payload: { resourceId: input.userId, version: input.config.version } });
    await publishPolicyChange({ ...this.context, db: tx }, { userId: input.userId, version: input.config.version });
  }
}
