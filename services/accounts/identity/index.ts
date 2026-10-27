import type { Migration, ModuleContext } from "@quire/runtime";
import { store } from "./store";
import { authentication } from "./authentication";
import { policy } from "./policy";
import { registerCredentials } from "./credentials";
import { registerProfile } from "./profile";
import { registerAccount } from "./account";
import { registerReads } from "./reads";

export const migrations: readonly Migration[] = [{
  id: "010-a-identity-local",
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
}];
export function register(context: ModuleContext): void {
  const repository = store(context);
  const auth = authentication(context, repository);
  context.services.provide("identity", auth.port);
  context.services.provide("policy", policy(context));
  registerCredentials(context, { repository, auth });
  registerProfile(context, { repository, auth });
  registerAccount(context, { repository, auth });
  registerReads(context, { repository, auth });
}
export { intersectPolicy } from "./policy";
export { sessionCookie } from "./authentication";
export { defaultPreferences } from "./store";
export type { IdentityPort, PolicyPort, Principal } from "@quire/runtime";
export { registerAuthProviderCapability } from "./reads";
export type { AuthProviderCapability } from "./reads";
