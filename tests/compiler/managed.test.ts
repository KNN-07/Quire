import { expect, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import { createRuntime } from "@quire/runtime";
import { CompilerService, CompilerLeases, migrations } from "../../services/compiler";
import { migrations as workerMigrations, register as workers } from "../../services/operations/workers";
import { defaultLimits } from "../../workers/compiler/sandbox";
import { seed } from "../../scripts/seed";
import { isolatedData } from "../fixtures/runtime";
import { fixtureIds as ids } from "../fixtures/foundation";
import { settings } from "./fixtures";
import { register as identity, migrations as identityMigrations } from "../../services/accounts/identity";

test("managed policy disables local execution and rejects unmanaged claims before job selection", async () => {
  await using data = await isolatedData();
  const runtime = await createRuntime(data.config, {
    modules: [
      { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
      { id: "030-c-selection-fixture", lane: "C", order: 30, migrations,
        register: context => { context.services.provide("compiler", new CompilerService(context, null)); } },
      { id: "080-o-workers", lane: "O", order: 80, migrations: workerMigrations, register: workers },
    ],
  });
  try {
    await seed(runtime, "managed-worker-regression-password");
    const compiler = runtime.services.get("compiler");
    if (!(compiler instanceof CompilerService)) throw new TypeError("Expected actual compiler service");
    const id = IdSchema.parse(crypto.randomUUID());
    await runtime.db.run(`INSERT INTO compile_jobs
      (id,actor_id,snapshot_id,environment_id,settings_json,status,queued_at,idempotency_key,queue_order)
      VALUES(?,?,?,?,?,'queued',?,'managed-fixture',1)`, [id, ids.kien, ids.snapshot, ids.environment,
      JSON.stringify(settings), runtime.clock.now()]);
    await runtime.db.run("INSERT INTO compiler_requests(job_id,digest,clean,limits_json,cache_key) VALUES(?,?,1,?,NULL)",
      [id, id, JSON.stringify(defaultLimits)]);
    await runtime.db.run("UPDATE o_worker_policy SET managed=1,maximum=0,timeout_seconds=30 WHERE id=1");
    expect(await compiler.remoteWorkers()).toBe(true);
    await compiler.start();
    expect(compiler.running).toBe(false);
    const local = await compiler.runJob(id).then(() => null, (error: unknown) => error);
    expect(local).toMatchObject({ code: "REMOTE_WORKER_REQUIRED" });
    const leases = new CompilerLeases(compiler);
    expect(await leases.lease(ids.operator, [ids.environment])).toBeNull();
    expect((await compiler.store.get(id)).status).toBe("queued");
    // The same real queued job is claimable in explicit legacy mode, with the pool wall cap.
    await runtime.db.run("UPDATE o_worker_policy SET managed=0 WHERE id=1");
    const accepted = await leases.lease(ids.operator, [ids.environment]);
    expect(accepted?.jobId).toBe(id);
    expect(accepted?.limits.wallSeconds).toBe(30);
  } finally { await runtime.close(); }
});
