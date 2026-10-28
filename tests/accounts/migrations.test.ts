import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, migrationSql } from "@quire/runtime";
import { migrations as identityMigrations, register as identity } from "../../services/accounts/identity";
import { migrations as governanceMigrations, register as governance } from "../../services/accounts/governance";
import { isolatedData } from "./fixture";

test("preserves the accepted SQLite migration digests while providing distinct PostgreSQL variants", () => {
  const migrations = [...identityMigrations, ...governanceMigrations];
  expect(migrations.filter(migration => migration.id !== "012-a-project-benefits")
    .map((migration) => new Bun.CryptoHasher("sha256").update(migration.sql).digest("hex"))).toEqual([
    "36537de09a04c6bf116c8ff538539d9fbc57be443752d41443ba9d7adf4a18c2",
    "b9698169246a92f3886390c335c4d653ebffcfac905cc5698198ba28dcba3038",
  ]);
  expect(identityMigrations.map(migration => migration.id)).toContain("012-a-project-benefits");
  const benefits = identityMigrations.find(migration => migration.id === "012-a-project-benefits");
  if (!benefits) throw new TypeError("Benefit migration missing");
  expect(new Bun.CryptoHasher("sha256").update(benefits.sql).digest("hex"))
    .toBe("3fb99ff1c1fa9fd0ec96dc9298dc3edd6076955d1491f961aa04f04f2eccea0e");
  expect(new Bun.CryptoHasher("sha256").update(migrationSql(benefits, "postgres")).digest("hex"))
    .toBe("18928a8f66f1db1293c3d3605d994e09517895a26fad0cb6094d74593037c511");
  for (const migration of migrations) {
    const postgres = migration.postgres;
    if (postgres === undefined) throw new Error("PostgreSQL variant missing");
    expect(migrationSql(migration, "postgres")).toBe(postgres);
    expect(migration.postgres).not.toBe(migration.sql);
  }
});

test("reopens accepted native account data without rewriting existing rows or migration receipts", async () => {
  await using sandbox = await isolatedData();
  const path = join(sandbox.path, "quire.sqlite");
  await cp(join(import.meta.dir, "../fixtures/portable-baseline.sqlite.fixture"), path);
  const native = new Database(path, { readonly: true });
  let users: Record<string, unknown>[];
  let receipts: Record<string, unknown>[];
  let members: Record<string, unknown>[];
  let policies: Record<string, unknown>[];
  try {
    users = native.query<Record<string, unknown>, []>("SELECT * FROM users ORDER BY id").all();
    receipts = native.query<Record<string, unknown>, []>("SELECT * FROM schema_migrations ORDER BY id").all();
    members = native.query<Record<string, unknown>, []>("SELECT * FROM project_members ORDER BY id").all();
    policies = native.query<Record<string, unknown>, []>("SELECT * FROM policy_sets ORDER BY id").all();
  } finally { native.close(true); }
  const runtime = await createRuntime(sandbox.config, { modules: [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
    { id: "011-a-governance", lane: "A", order: 11, register: governance, migrations: governanceMigrations },
  ] });
  try {
    expect(await runtime.db.all("SELECT * FROM users ORDER BY id")).toEqual(users);
    expect(await runtime.db.all("SELECT * FROM project_members ORDER BY id")).toEqual(members);
    expect(await runtime.db.all("SELECT * FROM policy_sets ORDER BY id")).toEqual(policies);
    expect(await runtime.db.get("SELECT count(*) AS n FROM projects WHERE writable_member_ids_json IS NOT NULL")).toEqual({ n: 0 });
    expect(await runtime.db.all("SELECT * FROM account_project_benefits")).toEqual([{
      scope_kind: "deployment", scope_id: "local",
      benefits_json: '{"compileSeconds":180,"writableMembers":null,"historyDays":null,"trackChanges":true}',
      version: 0, updated_at: "1970-01-01T00:00:00.000Z",
    }]);
    const applied = await runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
    for (const receipt of receipts) expect(applied).toContainEqual(receipt);
  } finally { await runtime.close(); }
});
