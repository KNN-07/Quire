import type { Migration } from "@quire/runtime";
export const migrations: readonly Migration[] = [{
  id: "021-k-base-source-intents",
  sql: `CREATE TABLE base_source_intents (
    id TEXT PRIMARY KEY REFERENCES git_intents(id), payload_json TEXT NOT NULL
  ) STRICT;
  CREATE TABLE base_link_members (
    member_id TEXT PRIMARY KEY REFERENCES project_members(id) ON DELETE CASCADE,
    share_id TEXT NOT NULL REFERENCES share_tokens(id)
  ) STRICT;
  CREATE TABLE base_operation_grants (
    operation_id TEXT PRIMARY KEY REFERENCES operations(id),
    project_id TEXT NOT NULL REFERENCES projects(id), token_hash TEXT NOT NULL,
    request_key TEXT NOT NULL, request_digest TEXT NOT NULL, UNIQUE(project_id,token_hash,request_key)
  ) STRICT;`,
}];
