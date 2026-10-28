import type { Migration } from "@quire/contracts";

const sql = `CREATE TABLE environment_receipts (
  environment_id TEXT PRIMARY KEY REFERENCES environments(id),
  version INTEGER NOT NULL DEFAULT 0, report_json TEXT NOT NULL,
  manifest_digest TEXT NOT NULL, created_by TEXT REFERENCES users(id)
);
CREATE TABLE environment_builds (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id),
  input_digest TEXT NOT NULL, environment_id TEXT REFERENCES environments(id)
);`;

export const migrations: readonly Migration[] = [{
  id: "060-o-environments", sql, postgres: sql,
}];
