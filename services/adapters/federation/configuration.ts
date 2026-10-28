import { z } from "zod";
import { IdentityConfigSchema, IdSchema } from "@quire/contracts";
import type { Capability, Id, IdentityConfig, SqlExecutor, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { requireEnrolledBreakGlass } from "../../accounts/identity";
import { SecretBox } from "../shared/secrets";
import { FederationProvisioning } from "./provisioning";

export type FederationDeployment = {
  readonly organizationId?: Id;
  readonly transferTo?: Id;
  readonly ldapAllowedUrls?: readonly string[];
  readonly ldapSubjectAttribute?: string;
};
export type FederationConfiguration = {
  readonly config: IdentityConfig;
  readonly oidcSecret: string | null;
  readonly ldapSecret: string | null;
};
const rowSchema = z.object({
  config_json: z.string(), version: z.number().int(),
  oidc_secret: z.instanceof(Uint8Array).nullable(), ldap_secret: z.instanceof(Uint8Array).nullable(),
});
export const emptyConfig: IdentityConfig = {
  protocol: "oidc", enabled: false, requireSso: false, createOnLogin: false,
  breakGlassUserId: IdSchema.parse("00000000-0000-0000-0000-000000000000"),
  domains: [], mappings: [], attributes: { email: "email", name: "name", groups: "groups" },
  saml: null, oidc: null, ldap: null, version: 0,
};
export class FederationConfigurations {
  private readonly box: SecretBox;
  constructor(readonly context: ModuleContext, readonly deployment: FederationDeployment) {
    this.box = new SecretBox(context.secretKey);
    if (deployment.organizationId !== undefined) IdSchema.parse(deployment.organizationId);
    if (deployment.transferTo !== undefined) IdSchema.parse(deployment.transferTo);
    if (deployment.ldapSubjectAttribute !== undefined) z.string().regex(/^[A-Za-z][A-Za-z0-9;-]*$/).parse(deployment.ldapSubjectAttribute);
    for (const value of deployment.ldapAllowedUrls ?? []) {
      const url = new URL(value);
      if (!["ldap:", "ldaps:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        (url.pathname !== "" && url.pathname !== "/")) throw new ServiceError("LDAP_ALLOWLIST_INVALID", 500, "Allowlist entries must be exact ldap/ldaps origins without credentials");
    }
  }
  async get(db: SqlExecutor = this.context.db): Promise<FederationConfiguration> {
    const value = await db.get("SELECT * FROM federation_configuration WHERE id=1");
    if (!value) return { config: emptyConfig, oidcSecret: null, ldapSecret: null };
    const row = rowSchema.parse(value);
    return {
      config: IdentityConfigSchema.parse({ ...IdentityConfigSchema.parse(JSON.parse(row.config_json)), version: row.version }),
      oidcSecret: row.oidc_secret ? this.box.open(row.oidc_secret, "federation:oidc") : null,
      ldapSecret: row.ldap_secret ? this.box.open(row.ldap_secret, "federation:ldap") : null,
    };
  }
  capability(settings: FederationConfiguration): Capability {
    const { config } = settings;
    if (!config.enabled) return { enabled: false, state: "disabled", reason: "Federation is disabled" };
    const missing: string[] = [];
    if (!this.deployment.organizationId) missing.push("assembly organizationId");
    if (!config.domains.length) missing.push("verified email domains");
    switch (config.protocol) {
      case "oidc":
        if (!config.oidc?.issuer) missing.push("OIDC issuer");
        if (!config.oidc?.clientId) missing.push("OIDC clientId");
        if (!settings.oidcSecret) missing.push("OIDC client secret");
        if (!config.oidc?.scopes.includes("openid")) missing.push("openid scope");
        break;
      case "saml":
        if (!config.saml?.entityId) missing.push("IdP entityId");
        if (!config.saml?.ssoUrl) missing.push("IdP ssoUrl");
        if (!config.saml?.certificates.length) missing.push("IdP signing certificates");
        break;
      case "ldap":
        if (!config.ldap?.url) missing.push("LDAP directory URL");
        if (!config.ldap?.baseDn) missing.push("LDAP baseDn");
        if (!config.ldap?.bindDn) missing.push("LDAP bindDn");
        if (!config.ldap?.caCertificate) missing.push("LDAP trusted CA certificate");
        if (!settings.ldapSecret) missing.push("LDAP bind secret");
        if (!this.deployment.ldapSubjectAttribute) missing.push("assembly ldapSubjectAttribute");
        if (!this.deployment.ldapAllowedUrls?.includes(config.ldap?.url ?? "")) missing.push("assembly ldapAllowedUrls entry");
        break;
      default: {
        const unreachable: never = config.protocol;
        throw new ServiceError("PROTOCOL_INVALID", 400, String(unreachable));
      }
    }
    return missing.length ? { enabled: false, state: "unconfigured", reason: `Missing: ${missing.join(", ")}` }
      : { enabled: true, state: "ready" };
  }
  async save(tx: Transaction, input: FederationConfiguration): Promise<IdentityConfig> {
    await tx.lock("quire:accounts");
    const current = await this.get(tx);
    if (current.config.version !== input.config.version) throw new ServiceError("VERSION_CONFLICT", 409, "Federation configuration changed");
    if (input.config.requireSso) {
      if (!this.capability(input).enabled) throw new ServiceError("FEDERATION_UNCONFIGURED", 409, this.capability(input).reason ?? "Federation disabled");
      await requireEnrolledBreakGlass(this.context, input.config.breakGlassUserId, tx);
    }
    if (this.deployment.organizationId && !await tx.get("SELECT id FROM organizations WHERE id=?", [this.deployment.organizationId])) {
      throw new ServiceError("ORGANIZATION_REQUIRED", 409, "Configured federation organization does not exist");
    }
    const config = { ...input.config, version: current.config.version + 1,
      oidc: input.config.oidc ? { ...input.config.oidc, secretPresent: Boolean(input.oidcSecret) } : null,
      ldap: input.config.ldap ? { ...input.config.ldap, secretPresent: Boolean(input.ldapSecret) } : null };
    await tx.run(`INSERT INTO federation_configuration(id,config_json,oidc_secret,ldap_secret,version) VALUES(1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,oidc_secret=excluded.oidc_secret,
      ldap_secret=excluded.ldap_secret,version=excluded.version`, [JSON.stringify(config),
      input.oidcSecret ? this.box.seal(input.oidcSecret, "federation:oidc") : null,
      input.ldapSecret ? this.box.seal(input.ldapSecret, "federation:ldap") : null, config.version]);
    const claims = await tx.all(`SELECT c.user_id,c.groups_json FROM federation_claims c JOIN users u ON u.id=c.user_id
      WHERE u.suspended=0 AND u.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM identity_breakglass b WHERE b.user_id=u.id)`);
    const provisioning = new FederationProvisioning(this.context, this.deployment);
    for (const value of claims) {
      const row = z.object({ user_id: IdSchema, groups_json: z.string() }).parse(value);
      await provisioning.apply(tx, { userId: row.user_id, config, groups: z.array(z.string()).parse(JSON.parse(row.groups_json)) });
    }
    return config;
  }
  async fence(tx: Transaction, expected: IdentityConfig): Promise<void> {
    const current = await this.get(tx);
    if (current.config.version !== expected.version || !this.capability(current).enabled) {
      throw new ServiceError("FEDERATION_CHANGED", 409, "Federation changed during authentication");
    }
  }
}
