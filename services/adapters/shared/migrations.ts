import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [{
  id: "060-x-shared-adapters",
  sql: `
CREATE TABLE adapter_provider_configs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL UNIQUE, base_url TEXT NOT NULL, model TEXT,
  encrypted_secret BLOB, policy_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE adapter_oauth_states (
  digest TEXT PRIMARY KEY, provider TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, verifier BLOB NOT NULL, redirect_uri TEXT NOT NULL,
  return_to TEXT NOT NULL, config_version INTEGER NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
) STRICT;
CREATE TABLE adapter_operation_receipts (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id), grant_id TEXT NOT NULL REFERENCES provider_grants(id),
  request_digest TEXT NOT NULL, grant_version INTEGER NOT NULL, config_version INTEGER NOT NULL
) STRICT;
CREATE TABLE adapter_grant_claims (
  grant_id TEXT PRIMARY KEY REFERENCES provider_grants(id), claim_id TEXT NOT NULL, expires_at TEXT NOT NULL
) STRICT;
`,
  postgres: `
CREATE TABLE adapter_provider_configs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL UNIQUE, base_url TEXT NOT NULL, model TEXT,
  encrypted_secret BYTEA, policy_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE adapter_oauth_states (
  digest TEXT PRIMARY KEY, provider TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, verifier BYTEA NOT NULL, redirect_uri TEXT NOT NULL,
  return_to TEXT NOT NULL, config_version INTEGER NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
);
CREATE TABLE adapter_operation_receipts (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id), grant_id TEXT NOT NULL REFERENCES provider_grants(id),
  request_digest TEXT NOT NULL, grant_version INTEGER NOT NULL, config_version INTEGER NOT NULL
);
CREATE TABLE adapter_grant_claims (
  grant_id TEXT PRIMARY KEY REFERENCES provider_grants(id), claim_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
`,
}, {
  id: "060-x-ai-operator-policy",
  sql: "CREATE TABLE adapter_ai_policy (id TEXT PRIMARY KEY CHECK(id='ai'), policy_json TEXT NOT NULL) STRICT;",
  postgres: "CREATE TABLE adapter_ai_policy (id TEXT PRIMARY KEY CHECK(id='ai'), policy_json TEXT NOT NULL);",
}];
