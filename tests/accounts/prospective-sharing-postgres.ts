import { strict as assert } from "node:assert";
import { createRuntime } from "@quire/runtime";
import { migrations, register } from "../../services/accounts/identity";
import { seed } from "../../scripts/seed";
import { isolatedData } from "./fixture";
import { postgresFixture } from "../core/review/postgres-fixture";
import { defaultPolicy, fixtureIds as ids } from "../fixtures/foundation";

const url = process.env["QUIRE_SHARING_POSTGRES_URL"];
if (!url) throw new Error("QUIRE_SHARING_POSTGRES_URL must name an owned disposable PostgreSQL server");
await using sandbox = await isolatedData();
const postgres = await postgresFixture(url);
try {
  const module = { id: "010-a-identity", lane: "A", order: 10, register, migrations } as const;
  let runtime = await createRuntime(sandbox.config, { createAdapters: postgres.createAdapters,
    modules: [{ ...module, migrations: migrations.filter(item => item.id !== "014-a-project-sharing") }] });
  try {
    await seed(runtime, "prospective-sharing-postgres-test");
    await runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify({ ...defaultPolicy, sharing: "anyone" })]);
    await runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
      VALUES(?,'organization',?,?,?)`, [crypto.randomUUID(), ids.team,
      JSON.stringify({ ...defaultPolicy, sharing: "organization" }), runtime.clock.now()]);
    const projects = await runtime.db.all("SELECT id,created_at,updated_at,version FROM projects ORDER BY id");
    await runtime.close();
    const before = Date.now();
    runtime = await createRuntime(sandbox.config, { createAdapters: postgres.createAdapters, modules: [module] });
    const baseline = await runtime.db.get<{ sharing: string; provenance: string; captured_at: string }>(
      "SELECT sharing,provenance,captured_at FROM account_project_sharing WHERE project_id=?", [ids.project]);
    assert(baseline);
    assert.equal(baseline.sharing, "organization");
    assert.equal(baseline.provenance, "migration");
    assert(Date.parse(baseline.captured_at) >= before);
    assert(Date.parse(baseline.captured_at) <= Date.now());
    assert.deepEqual(await runtime.db.all("SELECT id,created_at,updated_at,version FROM projects ORDER BY id"), projects);
    await runtime.db.run("DELETE FROM policy_sets WHERE scope_kind='organization'");
    assert.equal((await runtime.services.get("policy").forProject(ids.outsider, ids.project)).sharing, "organization");
    await runtime.close();
    runtime = await createRuntime(sandbox.config, { createAdapters: postgres.createAdapters, modules: [module] });
    assert.deepEqual(await runtime.db.get(
      "SELECT sharing,provenance,captured_at FROM account_project_sharing WHERE project_id=?", [ids.project]), baseline);
    console.info("C40A_POSTGRES_MIGRATION_PASS", { preservedOrigins: true, provenance: baseline.provenance, restart: true });
  } finally { await runtime.close(); }
} finally { await postgres.close(); }
