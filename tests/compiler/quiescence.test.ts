import { expect, spyOn, test } from "bun:test";
import { EnvironmentSchema, IdSchema } from "@quire/contracts";
import { createRuntime } from "@quire/runtime";
import { CompilerService, CompilerLeases, migrations } from "../../services/compiler";
import { quiesceCompilerJobs } from "../../services/compiler/quiescence";
import { register as identity, migrations as identityMigrations } from "../../services/accounts/identity";
import { defaultLimits } from "../../workers/compiler/sandbox";
import { isolatedData } from "../fixtures/runtime";
import { seed } from "../../scripts/seed";
import { settings, fixtureIds as ids } from "./fixtures";

test("stopped maintenance fences real compiler jobs while deferring event dispatch", async () => {
  await using data = await isolatedData();
  const runtime = await createRuntime({ ...data.config, compilerBackend: "docker" }, {
    modules: [
      { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
      // Maintenance opens schema without registering reapers, workers or routes.
      { id: "030-c-compiler", lane: "C", order: 30, migrations, register() {} },
    ],
  });
  let compiler: CompilerService | undefined;
  let unsubscribe = () => {};
  try {
    await seed(runtime, "deferred-quiescence-password");
    const row = await runtime.db.get<{ manifest_json: string }>("SELECT manifest_json FROM environments WHERE id=?", [ids.environment]);
    if (!row) throw new Error("Seeded environment required");
    compiler = new CompilerService({ ...runtime, routes: runtime.routes.forLane("C") },
      EnvironmentSchema.parse(JSON.parse(row.manifest_json)));
    const service = compiler;
    const jobs = [IdSchema.parse(crypto.randomUUID()), IdSchema.parse(crypto.randomUUID())];
    for (const [index, id] of jobs.entries()) {
      await runtime.db.run(`INSERT INTO compile_jobs
        (id,actor_id,snapshot_id,environment_id,settings_json,status,queued_at,idempotency_key,queue_order)
        VALUES(?,?,?,?,?,'queued',?,?,?)`, [id, ids.kien, ids.snapshot, ids.environment,
        JSON.stringify(settings), runtime.clock.now(), `deferred-${index}`, index + 1]);
      await runtime.db.run("INSERT INTO compiler_requests(job_id,digest,clean,limits_json,cache_key) VALUES(?,?,1,?,NULL)",
        [id, id, JSON.stringify(defaultLimits)]);
    }
    const leases = new CompilerLeases(compiler);
    const lease = await leases.lease(ids.operator, [ids.environment]);
    if (!lease) throw new Error("Actual worker lease required");
    const delivered: string[] = [];
    unsubscribe = runtime.events.subscribe(event => {
      if (event.topic === "job.changed" && event.payload.status === "canceled") delivered.push(event.payload.resourceId);
    });
    const task = spyOn(compiler, "task");
    try {
      await runtime.admission.exclusive(async () => {
        await quiesceCompilerJobs(service, { dispatch: "deferred" });
        // Inspect synchronous scheduling, not whether an async dispatch wins a race.
        expect(task).not.toHaveBeenCalled();
      });
      for (const id of jobs) {
        expect(await compiler.store.get(id)).toMatchObject({ status: "canceled", failureCode: "BACKUP_QUIESCED" });
      }
      expect(await runtime.db.get("SELECT job_id FROM worker_leases")).toBeNull();
      const late = await leases.fence(lease.jobId, lease).then(() => null, (error: unknown) => error);
      expect(late).toMatchObject({ code: "STALE_LEASE" });
      expect(delivered).toEqual([]);
      // Normal activation can later deliver the real persisted cancellation events.
      await runtime.events.dispatch();
      expect(delivered.sort()).toEqual([...jobs].sort());
    } finally {
      task.mockRestore();
    }
  } finally {
    unsubscribe();
    await compiler?.stop();
    await runtime.close();
  }
}, 30_000);
