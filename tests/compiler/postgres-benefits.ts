import { strict as assert } from "node:assert";
import { z } from "zod";
import { InstantSchema } from "@quire/contracts";
import { CompilerService, CompilerLeases } from "../../services/compiler";
import { compilerHttp } from "./http-fixture";
import { fixtureIds as ids, settings } from "./fixtures";
import { postgresFixture } from "../core/review/postgres-fixture";

const url = process.env["QUIRE_BENEFITS_POSTGRES_URL"];
if (!url) throw new TypeError("QUIRE_BENEFITS_POSTGRES_URL must name an owned disposable server");
const postgres = await postgresFixture(url);
try {
  await using app = await compilerHttp({ createAdapters: postgres.createAdapters,
    clock: { now: () => InstantSchema.parse("2026-10-27T12:00:00.000Z") } });
  assert.equal(app.runtime.db.dialect, "postgres");
  const compiler = app.runtime.services.get("compiler");
  if (!(compiler instanceof CompilerService)) throw new TypeError("Actual compiler required");
  const scope = { projectId: ids.project, branch: "main" };
  const basic = { compileSeconds: 12, writableMembers: 2, historyDays: 1, trackChanges: false };
  await app.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'", [JSON.stringify(basic)]);
  });
  // Given: an actually admitted PostgreSQL queue job and a subsequent larger owner grant.
  const started = await compiler.enqueue(ids.mai, { scope, expectedRevision: 0, settings, clean: true }, "postgres-budget");
  assert.equal((await compiler.limits(started.id)).wallSeconds, 12);
  await app.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run(`INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
      VALUES('user',?,?,1,?)`, [ids.kien, JSON.stringify({ ...basic, compileSeconds: 90, historyDays: null }), app.runtime.clock.now()]);
    await tx.run("UPDATE snapshots SET created_at='2026-10-25T12:00:00.000Z' WHERE id=?", [started.snapshot.id]);
  });
  // When: actual remote admission starts a bounded lease under current benefits.
  const leases = new CompilerLeases(compiler);
  const running = await leases.lease(ids.operator, [ids.environment]);
  assert(running);
  assert.equal(running.jobId, started.id);
  assert.equal(running.limits.wallSeconds, 90);
  await app.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("UPDATE account_project_benefits SET benefits_json=NULL,version=version+1 WHERE scope_kind='user' AND scope_id=?", [ids.kien]);
  });
  // Then: an already-running lease keeps that bounded budget and existing cancellation fences.
  assert.equal((await compiler.limits(started.id)).wallSeconds, 90);
  await assert.rejects(compiler.get(ids.kien, started.id), { code: "HISTORY_WINDOW" });
  await compiler.cancel(ids.kien, started.id);
  await assert.rejects(leases.heartbeat(started.id, running), { code: "STALE_LEASE" });
  const owner = await app.login();
  const selection = async (memberIds: readonly string[] | null) => {
    const version = z.object({ version: z.number() }).parse(await app.runtime.db.get("SELECT version FROM projects WHERE id=?", [ids.project])).version;
    return app.request(`/api/projects/${ids.project}/writable-members`, { method: "PUT", headers: owner,
      body: JSON.stringify({ memberIds, expectedVersion: version }) });
  };
  const remote = await compiler.enqueue(ids.mai, { scope, expectedRevision: 0, settings, clean: false }, "postgres-withdrawn");
  assert.equal((await selection([])).status, 200);
  assert.equal(await leases.lease(ids.operator, [ids.environment]), null);
  assert.equal((await compiler.store.get(remote.id)).failureCode, "POLICY_CHANGED");
  assert.equal((await compiler.store.raw(remote.id)).attempt, 0);
  assert.equal((await selection(null)).status, 200);
  const local = await compiler.enqueue(ids.mai, { scope, expectedRevision: 0, settings, clean: false }, "postgres-history");
  await app.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("UPDATE snapshots SET created_at='2026-10-25T12:00:00.000Z' WHERE id=?", [local.snapshot.id]);
  });
  await compiler.execute(local.id, AbortSignal.timeout(30000));
  assert.equal((await compiler.store.get(local.id)).failureCode, "POLICY_CHANGED");
  assert.equal((await compiler.store.raw(local.id)).attempt, 0);
  assert.equal((await compiler.store.get(local.id)).artifacts.length, 0);
  assert.equal(await app.runtime.db.get("SELECT job_id FROM worker_leases"), null);
  console.info("P4_COMPILER_POSTGRES_PASS", { currentClaimBudget: 90, runningBudgetRetained: true,
    remoteRoleWithdrawal: true, localHistoryWithdrawal: true, staleLeaseFenced: true });
} finally { await postgres.close(); }
