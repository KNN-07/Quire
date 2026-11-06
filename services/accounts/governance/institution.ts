import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { Migration, ModuleContext } from "@quire/runtime";
import { audit, authorize, conflict, missing, route } from "./shared";
import type { TransactionContext } from "./shared";

export const institutionMigration: Migration = {
  id: "011-c-institution-reconfirmation",
  sql: `CREATE TABLE institution_reconfirmation_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  reconfirmation_days INTEGER, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
  CHECK (reconfirmation_days IS NULL OR reconfirmation_days BETWEEN 1 AND 36500)
) STRICT;`,
  postgres: `CREATE TABLE institution_reconfirmation_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  reconfirmation_days INTEGER, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
  CHECK (reconfirmation_days IS NULL OR reconfirmation_days BETWEEN 1 AND 36500)
);`,
};
export async function institutionPolicy(context: TransactionContext, id: Id) {
  const row = z.object({ reconfirmation_days: z.number().nullable(), version: z.number() }).nullable().parse(
    await context.db.get("SELECT reconfirmation_days,version FROM institution_reconfirmation_policies WHERE organization_id=?", [id]));
  return { reconfirmationDays: row?.reconfirmation_days ?? null, version: row?.version ?? 0 };
}
export async function institutionEligibility(context: TransactionContext, slug: string, userId: Id) {
  const org = z.object({ id: IdSchema, domains_json: z.string() }).nullable().parse(
    await context.db.get("SELECT id,domains_json FROM organizations WHERE slug=? AND kind='institution'", [slug]));
  if (!org) throw missing();
  const domains = z.array(z.string()).parse(JSON.parse(org.domains_json));
  // Read current database state under the accounts lock, not a principal snapshot.
  const emails = z.array(z.object({ email: z.string() })).parse(
    await context.db.all("SELECT email FROM verified_emails WHERE user_id=?", [userId]));
  const eligible = emails.some(({ email }) => domains.includes(email.split("@")[1]?.toLowerCase() ?? ""));
  return { organizationId: org.id, eligible, ...await institutionPolicy(context, org.id) };
}
export function registerInstitution(context: ModuleContext): void {
  route(context, endpoints.institutionPolicyGet, async ({ params }, principal, request, bound) => {
    const org = await authorize(bound, principal, { organizationId: params.o, level: "admin" });
    if (org.kind !== "institution") throw missing();
    request.responseHeaders.set("cache-control", "private, no-store");
    return institutionPolicy(bound, org.id);
  });
  route(context, endpoints.institutionPolicyPut, async ({ params, body }, principal, _request, bound) => {
    const org = await authorize(bound, principal, { organizationId: params.o, level: "admin" });
    if (org.kind !== "institution") throw new ServiceError("INSTITUTION_REQUIRED", 409, "Reconfirmation is available for institutions");
    const previous = await institutionPolicy(bound, org.id);
    conflict(previous.version, body.expectedVersion);
    await bound.db.run(`INSERT INTO institution_reconfirmation_policies(organization_id,reconfirmation_days,version,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET reconfirmation_days=excluded.reconfirmation_days,
      version=excluded.version,updated_at=excluded.updated_at`,
    [org.id, body.reconfirmationDays, previous.version + 1, bound.clock.now()]);
    await audit(bound, principal, { organizationId: org.id, event: "institution.reconfirmation.configured", targetId: org.id,
      details: { reconfirmationDays: body.reconfirmationDays, version: previous.version + 1 } });
    return institutionPolicy(bound, org.id);
  });
  route(context, endpoints.institutionEligibility, async ({ params }, principal, request, bound) => {
    const current = await institutionEligibility(bound, params.slug, principal.user.id);
    const row = z.object({ checked_at: z.string(), expires_at: z.string().nullable() }).nullable().parse(
      await bound.db.get("SELECT checked_at,expires_at FROM institutional_eligibility WHERE organization_id=? AND user_id=?",
        [current.organizationId, principal.user.id]));
    const member = Boolean(await bound.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [current.organizationId, principal.user.id]));
    request.responseHeaders.set("cache-control", "private, no-store");
    return { eligible: current.eligible, member, reconfirmationDays: current.reconfirmationDays,
      checkedAt: row?.checked_at ?? null, expiresAt: row?.expires_at ?? null,
      state: !current.eligible ? "ineligible" : row?.expires_at && row.expires_at <= bound.clock.now() ? "expired" : row ? "current" : "not-enrolled" } as const;
  });
}
