import { z } from "zod";
import type { Id, IdentityConfig, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { defaultPreferences, newId } from "../../accounts/identity/store";
import { requireRemovableAccount, revokeSessions, transferProjects } from "../../accounts/governance/managed";
import { trustedAttributes } from "./provisioning";
import { userInput } from "./scim-schema";
import type { ResourceRow } from "./scim-schema";
import type { ScimStore } from "./scim-store";

export class ScimUsers {
  constructor(private readonly store: ScimStore) {}
  async create(tx: Transaction, body: unknown) {
    const input = userInput.parse(body);
    const existing = await this.store.existing(tx, { kind: "Users", externalId: input.externalId });
    if (existing) {
      if (existing.deleted_at || existing.data_json !== JSON.stringify(input)) throw new ServiceError("SCIM_EXTERNAL_ID_CONFLICT", 409, "externalId already identifies a different resource");
      return { row: existing, created: false };
    }
    const { config } = await this.store.configurations.get(tx);
    const name = input.displayName ?? ([input.name?.givenName, input.name?.familyName].filter(Boolean).join(" ") || input.userName);
    const primary = input.emails?.filter((entry) => entry.primary) ?? [];
    if (primary.length > 1) throw new ServiceError("SCIM_EMAIL_CONFLICT", 409, "Only one primary email is allowed");
    const email = z.email().parse(primary[0]?.value ?? input.emails?.[0]?.value ?? input.userName).toLowerCase();
    trustedAttributes(config, { [config.attributes.email]: email, [config.attributes.name]: name });
    if (await tx.get("SELECT id FROM users WHERE lower(primary_email)=? UNION SELECT user_id FROM verified_emails WHERE lower(email)=?", [email, email])) {
      throw new ServiceError("SCIM_EMAIL_CONFLICT", 409, "An existing local identity requires explicit linking, not SCIM takeover");
    }
    const userId = newId();
    const now = this.store.context.clock.now();
    await tx.run("INSERT INTO users(id,name,primary_email,suspended,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      [userId, name, email, input.active ? 0 : 1, now, now]);
    await tx.run("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)", [newId(), userId, email, now]);
    await tx.run("INSERT INTO preferences(user_id,value_json,updated_at) VALUES(?,?,?)", [userId, JSON.stringify(defaultPreferences), now]);
    // SCIM externalId is the immutable IdP subject, never an email auto-link.
    const issuers = { oidc: config.oidc?.issuer, saml: config.saml?.entityId, ldap: config.ldap?.url } satisfies
      Record<IdentityConfig["protocol"], string | undefined>;
    const issuer = issuers[config.protocol];
    if (!issuer) throw new ServiceError("SCIM_UNCONFIGURED", 503, "Configured identity issuer required");
    await tx.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)", [newId(), userId, issuer, input.externalId, now]);
    const row = await this.store.insert(tx, { kind: "Users", userId, data: input });
    if (input.active) await this.store.reconcile(tx, row.id);
    return { row, created: true };
  }
  async update(tx: Transaction, input: { readonly row: ResourceRow; readonly body: unknown; readonly remove?: boolean }) {
    const next = userInput.parse(input.body);
    const previous = userInput.parse(JSON.parse(input.row.data_json));
    const userId = input.row.user_id;
    if (!userId) throw new ServiceError("SCIM_RESOURCE_INVALID", 500, "SCIM user has no account");
    if (next.userName !== previous.userName || next.externalId !== previous.externalId) throw new ServiceError("SCIM_IMMUTABLE", 400, "userName and externalId are immutable");
    if (JSON.stringify(next.emails) !== JSON.stringify(previous.emails)) throw new ServiceError("SCIM_IMMUTABLE", 400, "Email changes require the account's verified-email workflow");
    if (await tx.get("SELECT user_id FROM identity_breakglass WHERE user_id=?", [userId])) throw new ServiceError("BREAKGLASS_PROTECTED", 403, "SCIM cannot modify an enrolled break-glass operator");
    if (!next.active || input.remove) await this.deactivate(tx, userId);
    else {
      const account = z.object({ suspended: z.number(), deleted_at: z.string().nullable() }).parse(await tx.get("SELECT suspended,deleted_at FROM users WHERE id=?", [userId]));
      if (account.deleted_at) throw new ServiceError("SCIM_ACCOUNT_DELETED", 409, "A deleted account cannot be restored by SCIM");
      if (!previous.active) await tx.run("UPDATE users SET suspended=0,version=version+1,updated_at=? WHERE id=?", [this.store.context.clock.now(), userId]);
      else if (account.suspended) throw new ServiceError("SCIM_ACCOUNT_SUSPENDED", 403, "Independent account suspension requires operator review");
    }
    const name = next.displayName ?? ([next.name?.givenName, next.name?.familyName].filter(Boolean).join(" ") || next.userName);
    await tx.run("UPDATE users SET name=?,version=version+1,updated_at=? WHERE id=?", [name, this.store.context.clock.now(), userId]);
    const row = await this.store.save(tx, { row: input.row, data: { ...next, active: input.remove ? false : next.active },
      ...(input.remove ? { deleted: true } : {}) });
    if (next.active && !input.remove) await this.store.reconcile(tx, row.id);
    return row;
  }
  private async deactivate(tx: Transaction, userId: Id) {
    const { context, configurations } = this.store;
    const bound = { ...context, db: tx };
    const management = await tx.get("SELECT state FROM managed_acceptances WHERE user_id=? AND organization_id=?",
      [userId, configurations.deployment.organizationId ?? null]);
    const state = management ? z.object({ state: z.string() }).parse(management).state : null;
    if (state === "released") throw new ServiceError("MANAGED_RELEASED", 409, "A released account requires its owner's independent account controls");
    await requireRemovableAccount(bound, userId);
    const ownsProjects = await tx.get("SELECT id FROM projects WHERE owner_id=? LIMIT 1", [userId]);
    if (ownsProjects) {
      const target = configurations.deployment.transferTo;
      if (!target) throw new ServiceError("SCIM_TRANSFER_REQUIRED", 409, "Set an explicit assembly transferTo before deactivating a project owner");
      if (!["accepted", "suspended"].includes(state ?? "") || !await tx.get("SELECT id FROM users WHERE id=? AND managed_by=?",
        [userId, configurations.deployment.organizationId ?? null])) {
        throw new ServiceError("MANAGED_ACCEPTANCE_REQUIRED", 409, "Project transfer requires explicit accepted management by this organization");
      }
      if (!await tx.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [configurations.deployment.organizationId ?? null, target])) {
        throw new ServiceError("SCIM_TRANSFER_DENIED", 409, "Transfer target must be a member of the configured organization");
      }
      await transferProjects(bound, { from: userId, to: target });
    }
    await revokeSessions(bound, userId);
    await tx.run("UPDATE users SET suspended=1,version=version+1,updated_at=? WHERE id=?", [context.clock.now(), userId]);
    await tx.run("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL WHERE owner_id=?", [userId]);
    await tx.run("UPDATE managed_acceptances SET state='suspended',version=version+1 WHERE user_id=? AND state='accepted'", [userId]);
    // No account, project, source, repository or management acceptance is deleted.
  }
}
