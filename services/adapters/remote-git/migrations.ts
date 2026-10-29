import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [{
  id: "062-x-remote-git",
  sql: `
CREATE UNIQUE INDEX remote_bindings_project_unique ON remote_bindings(project_id);
CREATE TABLE remote_git_intents (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
  actor_id TEXT NOT NULL REFERENCES users(id), grant_id TEXT NOT NULL REFERENCES provider_grants(id),
  action TEXT NOT NULL, project_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL
) STRICT;
`,
  postgres: `
CREATE UNIQUE INDEX remote_bindings_project_unique ON remote_bindings(project_id);
CREATE TABLE remote_git_intents (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
  actor_id TEXT NOT NULL REFERENCES users(id), grant_id TEXT NOT NULL REFERENCES provider_grants(id),
  action TEXT NOT NULL, project_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL
);
`,
}, {
  id: "062-x-remote-independent-import-cursors",
  sql: `UPDATE adapter_cursors SET cursor=NULL,version=version+1
    WHERE project_id='' AND action IN ('import','clone') AND cursor IS NOT NULL
    AND grant_id IN (SELECT id FROM provider_grants WHERE provider IN ('github','gitlab','git'));`,
  postgres: `UPDATE adapter_cursors SET cursor=NULL,version=version+1
    WHERE project_id='' AND action IN ('import','clone') AND cursor IS NOT NULL
    AND grant_id IN (SELECT id FROM provider_grants WHERE provider IN ('github','gitlab','git'));`,
}];
