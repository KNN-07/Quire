import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime } from "@quire/runtime";
import { migrations, register } from "../../services/accounts/identity";
import { isolatedData } from "./fixture";

test("upgrades legacy projects with current workspace baselines without rewriting immutable origin dates", async () => {
  await using sandbox = await isolatedData();
  const path = join(sandbox.path, "quire.sqlite");
  await cp(join(import.meta.dir, "../fixtures/portable-baseline.sqlite.fixture"), path);
  const old = new Database(path);
  let projects: Record<string, unknown>[];
  const before = Date.now();
  try {
    // An organization-scoped set is stricter than the current organization row.
    old.exec(`UPDATE organizations SET policy_json=json_set(policy_json,'$.sharing','anyone');
      INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
      SELECT 'upgrade-sharing-' || id,'organization',id,json_set(policy_json,'$.sharing','organization'),updated_at
      FROM organizations WHERE 1=1
      ON CONFLICT(scope_kind,scope_id) DO UPDATE SET policy_json=excluded.policy_json;`);
    projects = old.query<Record<string, unknown>, []>("SELECT id,created_at,updated_at,version FROM projects ORDER BY id").all();
  } finally { old.close(true); }
  const modules = [{ id: "010-a-identity", lane: "A", order: 10, register, migrations }] as const;
  let runtime = await createRuntime(sandbox.config, { modules });
  try {
    const rows = await runtime.db.all<{ project_id: string; workspace_id: string | null; sharing: string | null; provenance: string; captured_at: string }>(
      "SELECT * FROM account_project_sharing ORDER BY project_id");
    expect(rows.length).toBe(projects.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.provenance).toBe("migration");
      expect(row.sharing).toBe(row.workspace_id ? "organization" : null);
      expect(Date.parse(row.captured_at)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(row.captured_at)).toBeLessThanOrEqual(Date.now());
    }
    expect(await runtime.db.all("SELECT id,created_at,updated_at,version FROM projects ORDER BY id")).toEqual(projects);
    await runtime.db.run("UPDATE organizations SET policy_json=json_set(policy_json,'$.sharing','named')");
    await runtime.close();
    runtime = await createRuntime(sandbox.config, { modules });
    expect(await runtime.db.all("SELECT * FROM account_project_sharing ORDER BY project_id")).toEqual(rows);
    expect(await runtime.db.all("SELECT id,created_at,updated_at,version FROM projects ORDER BY id")).toEqual(projects);
  } finally { await runtime.close(); }
});
