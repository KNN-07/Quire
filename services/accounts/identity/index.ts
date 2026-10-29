import type { Migration, ModuleContext } from "@quire/runtime";
import { store } from "./store";
import { authentication } from "./authentication";
import { policy } from "./policy";
import { registerCredentials } from "./credentials";
import { registerProfile } from "./profile";
import { registerAccount } from "./account";
import { registerReads } from "./reads";
import { projectBenefitsMigration } from "./project-benefits-migration";
import { identityProvenanceMigration } from "./identity-provenance-migration";
import { onboardingMigration } from "./onboarding-migration";
import { registerOnboarding } from "./onboarding";
import { registerOnboardingImports } from "./onboarding-imports";

export const migrations: readonly Migration[] = [{
  id: "010-a-identity-local",
  postgres: `
CREATE UNIQUE INDEX identity_users_email_ci ON users(lower(primary_email));
CREATE UNIQUE INDEX identity_verified_email_ci ON verified_emails(lower(email));
CREATE TABLE identity_rate_limits (
  key TEXT NOT NULL, bucket INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(key,bucket)
);
CREATE TABLE identity_ai_consent (
  user_id TEXT PRIMARY KEY REFERENCES users(id), terms_version TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK(accepted IN (0,1)), updated_at TEXT NOT NULL
);
CREATE TABLE identity_requests (
  actor TEXT NOT NULL, route TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
  response_json TEXT NOT NULL, PRIMARY KEY(actor,route,key)
);
`,
  sql: `
CREATE TABLE identity_rate_limits (
  key TEXT NOT NULL, bucket INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(key,bucket)
) STRICT;
CREATE TABLE identity_ai_consent (
  user_id TEXT PRIMARY KEY REFERENCES users(id), terms_version TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK(accepted IN (0,1)), updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE identity_requests (
  actor TEXT NOT NULL, route TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
  response_json TEXT NOT NULL, PRIMARY KEY(actor,route,key)
) STRICT;
`,
}, projectBenefitsMigration, identityProvenanceMigration, onboardingMigration];
export function register(context: ModuleContext): void {
  const repository = store(context);
  const auth = authentication(context, repository);
  context.services.provide("identity", auth.port);
  context.services.provide("policy", policy(context));
  registerCredentials(context, { repository, auth });
  registerProfile(context, { repository, auth });
  registerAccount(context, { repository, auth });
  registerReads(context, { repository, auth });
  registerOnboarding(context, { repository, auth });
  registerOnboardingImports(context, { repository, auth });
}
export { intersectPolicy } from "./policy";
export { sessionCookie } from "./authentication";
export { defaultPreferences } from "./store";
export type { IdentityPort, PolicyPort, Principal } from "@quire/runtime";
export { registerAuthProviderCapability, registerAuthDiscovery } from "./reads";
export type { AuthProviderCapability } from "./reads";
export { registerIdentityPolicy, identityPolicy, passwordAllowed, requireEnrolledBreakGlass } from "./reads";
export type { IdentityPolicy } from "./reads";
export { enrollBreakGlass } from "./authentication";
