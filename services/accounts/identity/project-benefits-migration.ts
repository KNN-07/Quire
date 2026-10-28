import type { Migration } from "@quire/runtime";

export const projectBenefitsMigration: Migration = {
  id: "012-a-project-benefits",
  sql: `
CREATE TABLE account_project_benefits (
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('deployment','user','plan')),
  scope_id TEXT NOT NULL, benefits_json TEXT,
  version INTEGER NOT NULL CHECK(version>=0), updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_kind,scope_id),
  CHECK(scope_kind<>'deployment' OR (scope_id='local' AND benefits_json IS NOT NULL))
) STRICT;
INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
VALUES('deployment','local','{"compileSeconds":180,"writableMembers":null,"historyDays":null,"trackChanges":true}',0,'1970-01-01T00:00:00.000Z');
ALTER TABLE projects ADD COLUMN writable_member_ids_json TEXT;
`,
  postgres: `
CREATE TABLE account_project_benefits (
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('deployment','user','plan')),
  scope_id TEXT NOT NULL, benefits_json TEXT,
  version INTEGER NOT NULL CHECK(version>=0), updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_kind,scope_id),
  CHECK(scope_kind<>'deployment' OR (scope_id='local' AND benefits_json IS NOT NULL))
);
INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
VALUES('deployment','local','{"compileSeconds":180,"writableMembers":null,"historyDays":null,"trackChanges":true}',0,'1970-01-01T00:00:00.000Z');
ALTER TABLE projects ADD COLUMN writable_member_ids_json TEXT;
`,
};
