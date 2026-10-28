import { controlDigest } from "./protocol";

// Independent ledger. Never add this migration to application schema_migrations.
export const controlMigration = {
  id: "001-installation-control",
  sql: `
CREATE TABLE control_migrations (
  id TEXT PRIMARY KEY, digest TEXT NOT NULL
) STRICT;
CREATE TABLE installation (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  state_json TEXT NOT NULL CHECK(json_valid(state_json))
) STRICT;
CREATE TABLE commands (
  operation_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, request_key TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  UNIQUE(actor_id,request_key)
) STRICT;
CREATE TABLE executions (
  id TEXT PRIMARY KEY, unit TEXT NOT NULL, invocation_id TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  UNIQUE(unit,invocation_id)
) STRICT;
CREATE TABLE stopped_cohorts (
  operation_id TEXT NOT NULL REFERENCES commands(operation_id),
  generation INTEGER NOT NULL, epoch TEXT NOT NULL, evidence_json TEXT NOT NULL,
  PRIMARY KEY(operation_id,generation,epoch)
) STRICT;
CREATE TABLE execution_intents (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES commands(operation_id),
  record_json TEXT NOT NULL CHECK(json_valid(record_json))
) STRICT;
CREATE TABLE legacy_imports (
  source_id TEXT PRIMARY KEY, digest TEXT NOT NULL,
  snapshot_bytes TEXT NOT NULL, copied_at TEXT NOT NULL, removed_at TEXT, removal_receipt_bytes TEXT
) STRICT;
`,
};
export const controlMigrationDigest = controlDigest(controlMigration.sql);
