import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [{
  id: "069-x-ai",
  sql: `
CREATE TABLE ai_run_metadata (
  run_id TEXT PRIMARY KEY REFERENCES ai_runs(id), session_id TEXT NOT NULL,
  config_version INTEGER NOT NULL, conversation_id TEXT REFERENCES ai_conversations(id),
  request_json TEXT NOT NULL, request_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  error_code TEXT, undo_json TEXT NOT NULL DEFAULT '{}', context_digest TEXT, lease_until TEXT NOT NULL,
  manifest_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE(session_id,idempotency_key)
) STRICT;
CREATE TABLE ai_project_security (
  project_id TEXT PRIMARY KEY REFERENCES projects(id), confidential INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE ai_images (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  digest TEXT NOT NULL REFERENCES blobs(digest), expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE ai_conversation_retention (
  conversation_id TEXT PRIMARY KEY REFERENCES ai_conversations(id), expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE ai_source_journal (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES ai_runs(id), payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE ai_run_provenance (
  run_id TEXT NOT NULL REFERENCES ai_runs(id), provider TEXT NOT NULL, provider_id TEXT NOT NULL,
  provenance_json TEXT NOT NULL, PRIMARY KEY(run_id,provider,provider_id)
) STRICT;
`,
  postgres: `
CREATE TABLE ai_run_metadata (
  run_id TEXT PRIMARY KEY REFERENCES ai_runs(id), session_id TEXT NOT NULL,
  config_version INTEGER NOT NULL, conversation_id TEXT REFERENCES ai_conversations(id),
  request_json TEXT NOT NULL, request_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  error_code TEXT, undo_json TEXT NOT NULL DEFAULT '{}', context_digest TEXT, lease_until TEXT NOT NULL,
  manifest_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE(session_id,idempotency_key)
);
CREATE TABLE ai_project_security (
  project_id TEXT PRIMARY KEY REFERENCES projects(id), confidential INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ai_images (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  digest TEXT NOT NULL REFERENCES blobs(digest), expires_at TEXT NOT NULL
);
CREATE TABLE ai_conversation_retention (
  conversation_id TEXT PRIMARY KEY REFERENCES ai_conversations(id), expires_at TEXT NOT NULL
);
CREATE TABLE ai_source_journal (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES ai_runs(id), payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE ai_run_provenance (
  run_id TEXT NOT NULL REFERENCES ai_runs(id), provider TEXT NOT NULL, provider_id TEXT NOT NULL,
  provenance_json TEXT NOT NULL, PRIMARY KEY(run_id,provider,provider_id)
);
`,
}];
