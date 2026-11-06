import type { Migration } from "@quire/runtime";

const table = `CREATE TABLE account_project_sharing (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES organizations(id),
  sharing TEXT CHECK(sharing IN ('named','organization','anyone')),
  provenance TEXT NOT NULL CHECK(provenance IN ('migration','creation')),
  captured_at TEXT NOT NULL,
  CHECK((workspace_id IS NULL)=(sharing IS NULL))
)`;

function capture(json: string, timestamp: string, provenance: string, where: string): string {
  return `INSERT INTO account_project_sharing(project_id,workspace_id,sharing,provenance,captured_at)
SELECT p.id,p.workspace_id,
  (SELECT CASE MIN(CASE ${json} WHEN 'anyone' THEN 2 WHEN 'organization' THEN 1 ELSE 0 END)
    WHEN 0 THEN 'named' WHEN 1 THEN 'organization' WHEN 2 THEN 'anyone' END
   FROM (
     SELECT policy_json FROM organizations WHERE id=p.workspace_id
     UNION ALL
     SELECT policy_json FROM policy_sets WHERE scope_kind='organization' AND scope_id=p.workspace_id
   ) policies),
  '${provenance}',${timestamp}
FROM projects p ${where};`;
}

export const projectSharingMigration: Migration = {
  id: "014-a-project-sharing",
  sql: `${table} STRICT;
${capture("json_extract(policy_json,'$.sharing')", "strftime('%Y-%m-%dT%H:%M:%fZ','now')", "migration", "")}
CREATE TRIGGER account_project_sharing_create AFTER INSERT ON projects
BEGIN
  ${capture("json_extract(policy_json,'$.sharing')", "strftime('%Y-%m-%dT%H:%M:%fZ','now')", "creation", "WHERE p.id=NEW.id")}
END;`,
  postgres: `${table};
${capture("policy_json::jsonb->>'sharing'", "to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')", "migration", "")}
CREATE FUNCTION account_project_sharing_create() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  ${capture("policy_json::jsonb->>'sharing'", "to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')", "creation", "WHERE p.id=NEW.id")}
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_project_sharing_create AFTER INSERT ON projects
FOR EACH ROW EXECUTE FUNCTION account_project_sharing_create();`,
};
