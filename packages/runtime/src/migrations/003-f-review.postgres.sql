CREATE TABLE threads (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), branch TEXT NOT NULL,
  anchor_json TEXT, resolved BIGINT NOT NULL DEFAULT 0, version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL,
  edited_at TEXT, version BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE permanent_comment_tombstones (
  comment_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  deleted_by TEXT NOT NULL REFERENCES users(id), deleted_at TEXT NOT NULL
);
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), branch TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id), origin TEXT NOT NULL CHECK(origin IN ('human','ai')),
  version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE suggestion_edits (
  id TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL, anchor_json TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL,
  base_revision BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', version BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE history_versions (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES snapshots(id), review_snapshot_id TEXT NOT NULL,
  review_json TEXT NOT NULL, authors_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE version_labels (
  id TEXT PRIMARY KEY, history_version_id TEXT NOT NULL REFERENCES history_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), branch TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL,
  edited_at TEXT, version BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE access_requests (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('reviewer','editor')), message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX pending_access ON access_requests(project_id,user_id) WHERE status='pending';
CREATE TABLE share_tokens (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('viewer','editor')), revocation_version BIGINT NOT NULL DEFAULT 0,
  revoked_at TEXT, created_at TEXT NOT NULL
);
