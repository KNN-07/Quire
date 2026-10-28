import type { Migration } from "@quire/runtime";

export const migrations: readonly Migration[] = [{
  id: "011-a-identity-breakglass",
  sql: `
CREATE TABLE identity_breakglass (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enrolled_at TEXT NOT NULL
) STRICT;
`,
  postgres: `
CREATE TABLE identity_breakglass (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enrolled_at TEXT NOT NULL
);
`,
}, {
  id: "062-a-external-identity",
  sql: `
CREATE TABLE identity_oauth_states (
  digest TEXT PRIMARY KEY, provider TEXT NOT NULL, browser_hash TEXT NOT NULL,
  verifier BLOB NOT NULL, nonce TEXT NOT NULL, config_version INTEGER NOT NULL,
  redirect_uri TEXT NOT NULL, return_to TEXT NOT NULL, expires_at TEXT NOT NULL,
  consumed_at TEXT, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT, account_version INTEGER,
  CHECK((user_id IS NULL AND session_id IS NULL AND account_version IS NULL)
    OR (user_id IS NOT NULL AND session_id IS NOT NULL AND account_version IS NOT NULL))
) STRICT;
CREATE INDEX identity_oauth_expiry ON identity_oauth_states(expires_at);
`,
  postgres: `
CREATE TABLE identity_oauth_states (
  digest TEXT PRIMARY KEY, provider TEXT NOT NULL, browser_hash TEXT NOT NULL,
  verifier BYTEA NOT NULL, nonce TEXT NOT NULL, config_version INTEGER NOT NULL,
  redirect_uri TEXT NOT NULL, return_to TEXT NOT NULL, expires_at TEXT NOT NULL,
  consumed_at TEXT, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT, account_version INTEGER,
  CHECK((user_id IS NULL AND session_id IS NULL AND account_version IS NULL)
    OR (user_id IS NOT NULL AND session_id IS NOT NULL AND account_version IS NOT NULL))
);
CREATE INDEX identity_oauth_expiry ON identity_oauth_states(expires_at);
`,
}];
