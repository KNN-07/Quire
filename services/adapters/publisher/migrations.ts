import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [{
  id: "066-x-publisher",
  sql: `
CREATE TABLE publisher_submissions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  grant_id TEXT NOT NULL REFERENCES provider_grants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  archive_operation_id TEXT NOT NULL REFERENCES operations(id),
  archive_sha256 TEXT NOT NULL CHECK(length(archive_sha256)=64),
  destination_mode TEXT NOT NULL CHECK(destination_mode IN ('manual','direct')),
  state TEXT NOT NULL CHECK(state IN ('prepared','submitted')),
  remote_submission_id TEXT,
  provider_status TEXT,
  receipt TEXT,
  config_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX publisher_submissions_project ON publisher_submissions(project_id,created_at,id);
`,
  postgres: `
CREATE TABLE publisher_submissions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  grant_id TEXT NOT NULL REFERENCES provider_grants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  archive_operation_id TEXT NOT NULL REFERENCES operations(id),
  archive_sha256 TEXT NOT NULL CHECK(length(archive_sha256)=64),
  destination_mode TEXT NOT NULL CHECK(destination_mode IN ('manual','direct')),
  state TEXT NOT NULL CHECK(state IN ('prepared','submitted')),
  remote_submission_id TEXT,
  provider_status TEXT,
  receipt TEXT,
  config_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX publisher_submissions_project ON publisher_submissions(project_id,created_at,id);
`,
}];
