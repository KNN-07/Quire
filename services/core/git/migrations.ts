import type { Migration } from "@quire/runtime";
export const migrations: readonly Migration[] = [{
  id: "024-k-git-named-intents",
  sql: `CREATE TABLE core_git_intents (
    id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','conflicted'))
  ) STRICT;
  CREATE TABLE core_git_staging (
    project_id TEXT NOT NULL REFERENCES projects(id), branch TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id), head TEXT NOT NULL, revision INTEGER NOT NULL,
    hunks_json TEXT NOT NULL, PRIMARY KEY(project_id,branch,user_id)
  ) STRICT;
  CREATE TABLE core_git_receipts (
    actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL,
    digest TEXT NOT NULL, operation_json TEXT NOT NULL, PRIMARY KEY(actor_id,key)
  ) STRICT;`,
  postgres: `CREATE TABLE core_git_intents (
    id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','conflicted'))
  );
  CREATE TABLE core_git_staging (
    project_id TEXT NOT NULL REFERENCES projects(id), branch TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id), head TEXT NOT NULL, revision BIGINT NOT NULL,
    hunks_json TEXT NOT NULL, PRIMARY KEY(project_id,branch,user_id)
  );
  CREATE TABLE core_git_receipts (
    actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL,
    digest TEXT NOT NULL, operation_json TEXT NOT NULL, PRIMARY KEY(actor_id,key)
  );`,
}];
