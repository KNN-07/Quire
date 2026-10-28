import type { Migration } from "@quire/runtime";

export const migrations: readonly Migration[] = [{
  id: "024-k-catalog-publication",
  sql: `
    ALTER TABLE templates ADD COLUMN source_project_id TEXT REFERENCES projects(id);
    ALTER TABLE templates ADD COLUMN current_version_id TEXT;
    ALTER TABLE templates ADD COLUMN published_version_id TEXT;
    CREATE TABLE catalog_roles (
      user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('curator','template-publisher')),
      scope TEXT NOT NULL DEFAULT '*', PRIMARY KEY(user_id,role,scope)
    ) STRICT;
    CREATE INDEX catalog_library_owner ON library_entries(owner_id,id);
    CREATE INDEX catalog_template_versions ON template_versions(template_id,created_at,id);
  `,
  postgres: `
    ALTER TABLE templates ADD COLUMN source_project_id TEXT REFERENCES projects(id);
    ALTER TABLE templates ADD COLUMN current_version_id TEXT;
    ALTER TABLE templates ADD COLUMN published_version_id TEXT;
    CREATE TABLE catalog_roles (
      user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('curator','template-publisher')),
      scope TEXT NOT NULL DEFAULT '*', PRIMARY KEY(user_id,role,scope)
    );
    CREATE INDEX catalog_library_owner ON library_entries(owner_id,id);
    CREATE INDEX catalog_template_versions ON template_versions(template_id,created_at,id);
  `,
}];
