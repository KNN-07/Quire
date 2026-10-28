CREATE TABLE blobs (
  digest TEXT PRIMARY KEY CHECK(length(digest)=64), bytes BIGINT NOT NULL CHECK(bytes>=0), created_at TEXT NOT NULL
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT REFERENCES organizations(id), default_branch TEXT NOT NULL DEFAULT 'main',
  settings_json TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE project_members (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('editor','reviewer','viewer')),
  version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(project_id,user_id)
);
CREATE TABLE branch_workspaces (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 0, epoch BIGINT NOT NULL DEFAULT 0,
  fencing_token BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(project_id,branch)
);
CREATE TABLE files (
  id TEXT NOT NULL, branch_id TEXT NOT NULL REFERENCES branch_workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('file','folder')), mime TEXT NOT NULL,
  blob TEXT REFERENCES blobs(digest), bytes BIGINT NOT NULL DEFAULT 0, editable BIGINT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 0, epoch BIGINT NOT NULL DEFAULT 0, link_json TEXT,
  deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(id,branch_id)
);
CREATE UNIQUE INDEX live_file_paths ON files(branch_id,path) WHERE deleted_at IS NULL;
CREATE TABLE document_states (
  doc_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  epoch BIGINT NOT NULL DEFAULT 0, revision BIGINT NOT NULL DEFAULT 0, text TEXT NOT NULL,
  state BYTEA NOT NULL, state_vector BYTEA NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(file_id,branch_id) REFERENCES files(id,branch_id) ON DELETE CASCADE,
  UNIQUE(file_id,branch_id)
);
CREATE TABLE document_updates (
  id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES document_states(doc_id) ON DELETE CASCADE,
  client_id TEXT NOT NULL, client_seq BIGINT NOT NULL, epoch BIGINT NOT NULL, revision BIGINT NOT NULL,
  update_bytes BYTEA NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE(doc_id,client_id,client_seq)
);
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), branch TEXT NOT NULL,
  revision BIGINT NOT NULL, tree TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE snapshot_files (
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, file_id TEXT NOT NULL,
  path TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, blob TEXT REFERENCES blobs(digest),
  bytes BIGINT NOT NULL, editable BIGINT NOT NULL, revision BIGINT NOT NULL, epoch BIGINT NOT NULL,
  link_json TEXT, PRIMARY KEY(snapshot_id,file_id), UNIQUE(snapshot_id,path)
);
CREATE TABLE project_user_state (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived','trash')), branch TEXT NOT NULL DEFAULT 'main',
  version BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(project_id,user_id)
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, color_hex TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(user_id,name)
);
CREATE TABLE tag_assignments (
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY(tag_id,project_id)
);
CREATE TABLE repositories (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, relative_path TEXT NOT NULL UNIQUE,
  object_format TEXT NOT NULL DEFAULT 'sha1', created_at TEXT NOT NULL
);
CREATE TABLE git_intents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), branch TEXT NOT NULL,
  expected_ref TEXT, new_ref TEXT NOT NULL, tree TEXT NOT NULL, snapshot_id TEXT REFERENCES snapshots(id),
  state TEXT NOT NULL, idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, finalized_at TEXT,
  UNIQUE(project_id,idempotency_key)
);
CREATE TABLE branch_heads (
  project_id TEXT NOT NULL REFERENCES projects(id), branch TEXT NOT NULL, head TEXT NOT NULL,
  intent_id TEXT REFERENCES git_intents(id), version BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(project_id,branch)
);
CREATE TABLE user_staging (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id),
  branch TEXT NOT NULL, base_head TEXT NOT NULL, base_revision BIGINT NOT NULL, hunk_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE remote_bindings (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), provider TEXT NOT NULL,
  grant_id TEXT, remote_url TEXT NOT NULL, branch TEXT NOT NULL, cursor TEXT, version BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE invitations ADD CONSTRAINT invitations_project_fk
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE;
