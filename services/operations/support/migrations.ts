import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [{
  id: "085-o-support",
  sql: `
CREATE TABLE support_siem (
  id INTEGER PRIMARY KEY CHECK(id=1), endpoint TEXT NOT NULL, encrypted_secret BLOB,
  enabled INTEGER NOT NULL, authorized_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT, last_error TEXT,
  lease_owner TEXT, lease_until TEXT, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE support_inquiries (
  id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id), request_json TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, queued_at TEXT
) STRICT;
`,
  postgres: `
CREATE TABLE support_siem (
  id INTEGER PRIMARY KEY CHECK(id=1), endpoint TEXT NOT NULL, encrypted_secret BYTEA,
  enabled INTEGER NOT NULL, authorized_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL, cursor BIGINT NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT, last_error TEXT,
  lease_owner TEXT, lease_until TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE support_inquiries (
  id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id), request_json TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, queued_at TEXT
);
`,
}];
