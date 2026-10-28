import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [{
  id: "064-x-dropbox",
  sql: `
CREATE TABLE dropbox_sync (
  grant_id TEXT NOT NULL REFERENCES provider_grants(id), project_id TEXT NOT NULL REFERENCES projects(id),
  state_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, next_at TEXT NOT NULL,
  PRIMARY KEY(grant_id,project_id)
) STRICT;
CREATE TABLE dropbox_journal (
  grant_id TEXT NOT NULL REFERENCES provider_grants(id), project_id TEXT NOT NULL REFERENCES projects(id),
  payload_json TEXT NOT NULL, PRIMARY KEY(grant_id,project_id)
) STRICT;
CREATE TABLE dropbox_policies (
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('organization','project')),
  scope_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), version INTEGER NOT NULL,
  PRIMARY KEY(scope_kind,scope_id)
) STRICT;
CREATE TABLE dropbox_retries (
  grant_id TEXT NOT NULL REFERENCES provider_grants(id), project_id TEXT NOT NULL REFERENCES projects(id),
  retry_at TEXT NOT NULL, PRIMARY KEY(grant_id,project_id)
) STRICT;
`,
  postgres: `
CREATE TABLE dropbox_sync (
  grant_id TEXT NOT NULL REFERENCES provider_grants(id), project_id TEXT NOT NULL REFERENCES projects(id),
  state_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, next_at TEXT NOT NULL,
  PRIMARY KEY(grant_id,project_id)
);
CREATE TABLE dropbox_journal (
  grant_id TEXT NOT NULL REFERENCES provider_grants(id), project_id TEXT NOT NULL REFERENCES projects(id),
  payload_json TEXT NOT NULL, PRIMARY KEY(grant_id,project_id)
);
CREATE TABLE dropbox_policies (
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('organization','project')),
  scope_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), version INTEGER NOT NULL,
  PRIMARY KEY(scope_kind,scope_id)
);
CREATE TABLE dropbox_retries (
  grant_id TEXT NOT NULL REFERENCES provider_grants(id), project_id TEXT NOT NULL REFERENCES projects(id),
  retry_at TEXT NOT NULL, PRIMARY KEY(grant_id,project_id)
);
`,
}];
