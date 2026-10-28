import type { Migration } from "@quire/runtime";

export const migrations: readonly Migration[] = [{
  id: "066-x-federation",
  sql: `
CREATE TABLE federation_configuration (
  id INTEGER PRIMARY KEY CHECK(id=1), config_json TEXT NOT NULL,
  oidc_secret BLOB, ldap_secret BLOB, version INTEGER NOT NULL
) STRICT;
CREATE TABLE federation_requests (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;
CREATE TABLE federation_replays (
  issuer TEXT NOT NULL, assertion_id TEXT NOT NULL, expires_at TEXT NOT NULL,
  PRIMARY KEY(issuer,assertion_id)
) STRICT;
CREATE TABLE federation_tokens (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE TABLE federation_resources (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('Users','Groups')),
  external_id TEXT NOT NULL, data_json TEXT NOT NULL, user_id TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE(kind,external_id)
) STRICT;
CREATE TABLE federation_members (
  group_id TEXT NOT NULL REFERENCES federation_resources(id),
  resource_id TEXT NOT NULL REFERENCES federation_resources(id),
  PRIMARY KEY(group_id,resource_id)
) STRICT;
CREATE TABLE federation_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id), organization_id TEXT NOT NULL REFERENCES organizations(id)
) STRICT;
CREATE TABLE federation_claims (
  user_id TEXT PRIMARY KEY REFERENCES users(id), groups_json TEXT NOT NULL
) STRICT;
CREATE TABLE federation_tests (
  id TEXT PRIMARY KEY REFERENCES operations(id), config_json TEXT NOT NULL,
  oidc_secret BLOB, ldap_secret BLOB, nonce_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id), session_id TEXT NOT NULL,
  expires_at TEXT NOT NULL, state_digest TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL
) STRICT;
`,
  postgres: `
CREATE TABLE federation_configuration (
  id INTEGER PRIMARY KEY CHECK(id=1), config_json TEXT NOT NULL,
  oidc_secret BYTEA, ldap_secret BYTEA, version INTEGER NOT NULL
);
CREATE TABLE federation_requests (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE federation_replays (
  issuer TEXT NOT NULL, assertion_id TEXT NOT NULL, expires_at TEXT NOT NULL,
  PRIMARY KEY(issuer,assertion_id)
);
CREATE TABLE federation_tokens (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE federation_resources (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('Users','Groups')),
  external_id TEXT NOT NULL, data_json TEXT NOT NULL, user_id TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE(kind,external_id)
);
CREATE TABLE federation_members (
  group_id TEXT NOT NULL REFERENCES federation_resources(id),
  resource_id TEXT NOT NULL REFERENCES federation_resources(id),
  PRIMARY KEY(group_id,resource_id)
);
CREATE TABLE federation_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id), organization_id TEXT NOT NULL REFERENCES organizations(id)
);
CREATE TABLE federation_claims (
  user_id TEXT PRIMARY KEY REFERENCES users(id), groups_json TEXT NOT NULL
);
CREATE TABLE federation_tests (
  id TEXT PRIMARY KEY REFERENCES operations(id), config_json TEXT NOT NULL,
  oidc_secret BYTEA, ldap_secret BYTEA, nonce_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id), session_id TEXT NOT NULL,
  expires_at TEXT NOT NULL, state_digest TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL
);
`,
}];
