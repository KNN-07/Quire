import type { Migration } from "@quire/contracts";

const schema = `
  CREATE TABLE reference_provenance (
    owner_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL, provider_id TEXT NOT NULL,
    response_digest TEXT NOT NULL, endpoint TEXT NOT NULL, retrieved_at TEXT NOT NULL,
    publication_json TEXT NOT NULL, PRIMARY KEY(owner_id,provider,provider_id,response_digest)
  );
  CREATE TABLE reference_links (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES provider_grants(id),
    owner_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL REFERENCES projects(id),
    branch TEXT NOT NULL, file_id TEXT NOT NULL, selection_json TEXT NOT NULL,
    digest TEXT NOT NULL, cursor TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    UNIQUE(project_id,branch,file_id)
  );
  CREATE TABLE reference_library_sources (
    grant_id TEXT NOT NULL REFERENCES provider_grants(id), selection_key TEXT NOT NULL,
    provider_id TEXT NOT NULL, library_id TEXT NOT NULL REFERENCES library_entries(id) ON DELETE CASCADE,
    PRIMARY KEY(grant_id,selection_key,provider_id), UNIQUE(library_id)
  );
  CREATE TABLE reference_schedules (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), grant_id TEXT NOT NULL REFERENCES provider_grants(id),
    selection_json TEXT NOT NULL, interval_ms INTEGER NOT NULL, due_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    last_error TEXT, UNIQUE(grant_id,selection_json)
  );
  CREATE TABLE reference_source_journal (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), grant_id TEXT NOT NULL REFERENCES provider_grants(id),
    source_json TEXT NOT NULL, link_json TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL
  );
`;
export const migrations: readonly Migration[] = [{
  id: "064-x-references",
  sql: schema.replaceAll("\n  );", "\n  ) STRICT;"),
  postgres: schema,
}];
