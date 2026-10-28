import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [{
  id: "080-o-workers",
  sql: `
CREATE TABLE o_worker_policy (
  id INTEGER PRIMARY KEY CHECK(id=1), minimum INTEGER NOT NULL DEFAULT 0,
  maximum INTEGER NOT NULL DEFAULT 2, requested INTEGER NOT NULL DEFAULT 0,
  timeout_seconds INTEGER NOT NULL DEFAULT 180, sandbox TEXT NOT NULL DEFAULT 'bwrap',
  version INTEGER NOT NULL DEFAULT 0, managed INTEGER NOT NULL DEFAULT 0,
  CHECK(minimum>=0 AND minimum<=maximum AND maximum<=32),
  CHECK(requested>=0 AND requested<=maximum),
  CHECK(timeout_seconds>0 AND timeout_seconds<=600)
) STRICT;
INSERT INTO o_worker_policy(id) VALUES(1);
CREATE TABLE o_worker_controller (
  id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL,
  expires_at TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE o_worker_processes (
  id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, owner TEXT NOT NULL,
  desired TEXT NOT NULL CHECK(desired IN ('running','draining','stopped','deleted')),
  pid INTEGER, started_at TEXT NOT NULL, exited_at TEXT, exit_code INTEGER,
  version INTEGER NOT NULL DEFAULT 0, drain_operation TEXT REFERENCES operations(id)
) STRICT;
CREATE INDEX o_worker_owner ON o_worker_processes(owner,desired);
CREATE TABLE o_worker_requests (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id), target INTEGER NOT NULL
) STRICT;
`,
  postgres: `
CREATE TABLE o_worker_policy (
  id INTEGER PRIMARY KEY CHECK(id=1), minimum INTEGER NOT NULL DEFAULT 0,
  maximum INTEGER NOT NULL DEFAULT 2, requested INTEGER NOT NULL DEFAULT 0,
  timeout_seconds INTEGER NOT NULL DEFAULT 180, sandbox TEXT NOT NULL DEFAULT 'bwrap',
  version INTEGER NOT NULL DEFAULT 0, managed INTEGER NOT NULL DEFAULT 0,
  CHECK(minimum>=0 AND minimum<=maximum AND maximum<=32),
  CHECK(requested>=0 AND requested<=maximum),
  CHECK(timeout_seconds>0 AND timeout_seconds<=600)
);
INSERT INTO o_worker_policy(id) VALUES(1);
CREATE TABLE o_worker_controller (
  id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL,
  expires_at TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE o_worker_processes (
  id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, owner TEXT NOT NULL,
  desired TEXT NOT NULL CHECK(desired IN ('running','draining','stopped','deleted')),
  pid INTEGER, started_at TEXT NOT NULL, exited_at TEXT, exit_code INTEGER,
  version INTEGER NOT NULL DEFAULT 0, drain_operation TEXT REFERENCES operations(id)
);
CREATE INDEX o_worker_owner ON o_worker_processes(owner,desired);
CREATE TABLE o_worker_requests (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id), target INTEGER NOT NULL
);
`,
}, {
  id: "081-o-worker-profiles",
  sql: `ALTER TABLE o_worker_processes ADD COLUMN backend TEXT NOT NULL DEFAULT 'bwrap'
    CHECK(backend IN ('bwrap','docker'));
    ALTER TABLE o_worker_processes ADD COLUMN environment_ids_json TEXT NOT NULL DEFAULT '[]';`,
  postgres: `ALTER TABLE o_worker_processes ADD COLUMN backend TEXT NOT NULL DEFAULT 'bwrap'
    CHECK(backend IN ('bwrap','docker'));
    ALTER TABLE o_worker_processes ADD COLUMN environment_ids_json TEXT NOT NULL DEFAULT '[]';`,
}];
