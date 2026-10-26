CREATE TABLE environments (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, release TEXT NOT NULL, backend TEXT NOT NULL,
  manifest_json TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 0, probe_at TEXT,
  retired_at TEXT, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE compile_jobs (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  environment_id TEXT NOT NULL REFERENCES environments(id), settings_json TEXT NOT NULL, status TEXT NOT NULL,
  queued_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, elapsed_ms INTEGER, failure_code TEXT,
  worker_id TEXT, attempt INTEGER NOT NULL DEFAULT 0, fencing_token INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, UNIQUE(actor_id,idempotency_key)
) STRICT;
CREATE INDEX compile_queue ON compile_jobs(status,queued_at);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES compile_jobs(id), name TEXT NOT NULL, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, sha256 TEXT NOT NULL REFERENCES blobs(digest), kind TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(job_id,name)
) STRICT;
CREATE TABLE diagnostics (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES compile_jobs(id), severity TEXT NOT NULL,
  message TEXT NOT NULL, file_id TEXT, line INTEGER, column INTEGER, raw_start INTEGER NOT NULL, raw_end INTEGER NOT NULL
) STRICT;
CREATE TABLE workers (
  id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, state TEXT NOT NULL, environment_ids_json TEXT NOT NULL,
  job_id TEXT REFERENCES compile_jobs(id), last_heartbeat TEXT NOT NULL, builds_today INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE worker_leases (
  job_id TEXT PRIMARY KEY REFERENCES compile_jobs(id), worker_id TEXT NOT NULL REFERENCES workers(id),
  attempt INTEGER NOT NULL, fencing_token INTEGER NOT NULL, expires_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL
) STRICT;
CREATE TABLE operations (
  id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), kind TEXT NOT NULL, status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0, result_json TEXT, error_code TEXT, idempotency_key TEXT,
  version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(actor_id,idempotency_key)
) STRICT;
CREATE TABLE linked_files (
  id TEXT PRIMARY KEY, file_id TEXT NOT NULL, branch_id TEXT NOT NULL, kind TEXT NOT NULL,
  source_project_id TEXT REFERENCES projects(id), source_file_id TEXT, source_url TEXT, grant_id TEXT,
  expected_digest TEXT, source_digest TEXT, last_refreshed_at TEXT, version INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(file_id,branch_id) REFERENCES files(id,branch_id)
) STRICT;
CREATE TABLE provider_grants (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL,
  encrypted_secret BLOB, state TEXT NOT NULL, scopes_json TEXT NOT NULL, expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE adapter_cursors (
  grant_id TEXT NOT NULL REFERENCES provider_grants(id), action TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
  cursor TEXT, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(grant_id,action,project_id)
) STRICT;
CREATE TABLE library_entries (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), citation_key TEXT NOT NULL, bibtex TEXT NOT NULL,
  origin TEXT NOT NULL, provider_id TEXT, readonly INTEGER NOT NULL DEFAULT 0, publication_json TEXT,
  version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE templates (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), organization_id TEXT REFERENCES organizations(id),
  name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, license TEXT NOT NULL,
  visibility TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE template_versions (
  id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES templates(id),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id), name TEXT NOT NULL, category TEXT NOT NULL,
  description TEXT NOT NULL, license TEXT NOT NULL, visibility TEXT NOT NULL, status TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id), version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL REFERENCES projects(id),
  branch TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, messages_json TEXT NOT NULL DEFAULT '[]',
  proposals_json TEXT NOT NULL DEFAULT '[]', sources_json TEXT NOT NULL DEFAULT '[]', usage_id TEXT NOT NULL,
  provider_request_id TEXT, version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, state TEXT NOT NULL,
  dispatched_at TEXT, refunded_at TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX ai_daily ON ai_usage(user_id,day,state);
CREATE TABLE ai_conversations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), author_id TEXT NOT NULL REFERENCES users(id),
  messages_json TEXT NOT NULL DEFAULT '[]', shared INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, resource_id TEXT NOT NULL,
  read_at TEXT, version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id), events_json TEXT NOT NULL, channels_json TEXT NOT NULL,
  project_overrides_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE mail_outbox (
  id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, sent_at TEXT
) STRICT;
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, topic TEXT NOT NULL,
  aggregate_id TEXT NOT NULL, at TEXT NOT NULL, payload_json TEXT NOT NULL
) STRICT;
CREATE INDEX events_aggregate ON events(aggregate_id,seq);
CREATE TABLE outbox (
  event_seq INTEGER PRIMARY KEY REFERENCES events(seq), published_at TEXT, attempts INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE idempotency_results (
  actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, route TEXT NOT NULL, request_digest TEXT NOT NULL,
  status INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(actor_id,key,route)
) STRICT;
