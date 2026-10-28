import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [{
  id: "066-x-interchange-uploads",
  sql: `CREATE TABLE interchange_uploads (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blob TEXT NOT NULL REFERENCES blobs(digest), filename TEXT NOT NULL, mime TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK(bytes>0), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX interchange_upload_owner ON interchange_uploads(owner_id,expires_at);`,
  postgres: `CREATE TABLE interchange_uploads (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blob TEXT NOT NULL REFERENCES blobs(digest), filename TEXT NOT NULL, mime TEXT NOT NULL,
    bytes BIGINT NOT NULL CHECK(bytes>0), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );
  CREATE INDEX interchange_upload_owner ON interchange_uploads(owner_id,expires_at);`,
}];
