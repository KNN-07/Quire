import { expect, test } from "bun:test";
import { z } from "zod";
import { CompileJobSchema, EnvironmentSchema, IdSchema } from "@quire/contracts";
import { createRuntime } from "@quire/runtime";
import { CompilerService, CompilerLeases, configureCompilerEnvironments, quiesceCompiler,
  register, migrations, stopWorker } from "../../services/compiler";
import { build } from "../../workers/compiler/build";
import { defaultLimits } from "../../workers/compiler/sandbox";
import { compilerHttp } from "./http-fixture";
import { settings, terminalEvent, fixtureIds as ids } from "./fixtures";
import { isolatedData } from "../fixtures/runtime";
import { seed } from "../../scripts/seed";
import { register as identity, migrations as identityMigrations } from "../../services/accounts/identity";

test("detached compilation survives its admitting HTTP response", async () => {
  await using app = await compilerHttp();
  const manifest = z.object({ manifest_json: z.string() }).parse(
    await app.runtime.db.get("SELECT manifest_json FROM environments WHERE id=?", [ids.environment]));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const deadline = setTimeout(() => entered.reject(new Error("Build did not enter its barrier")), 30000);
  configureCompilerEnvironments(app.runtime, {
    resolve: async () => EnvironmentSchema.parse(JSON.parse(manifest.manifest_json)),
    build: async input => { entered.resolve(); await release.promise; return build(input); },
  });
  try {
    await app.runtime.start();
    const headers = await app.login();
    const done = terminalEvent(app.runtime);
    const response = await app.request(`/api/projects/${ids.project}/compiles`, {
      method: "POST", headers: { ...headers, "idempotency-key": "detached-admission" },
      body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0,
        settings: { ...settings, stopOnFirstError: false }, clean: true }),
    });
    expect(response.status).toBe(202);
    const job = z.object({ data: CompileJobSchema }).parse(await response.json()).data;
    await entered.promise;
    expect((await app.runtime.store.get(job.id)).status).toBe("running");
    release.resolve();
    await done;
    const result = await app.runtime.store.get(job.id);
    expect(result.status).toBe("succeeded");
    expect(result.artifacts.some(artifact => artifact.name === "output.pdf")).toBe(true);
  } finally { clearTimeout(deadline); release.resolve(); }
}, 180000);

test("backup quiescence cancels queued jobs and fences existing remote callbacks", async () => {
  await using data = await isolatedData();
  const runtime = await createRuntime({ ...data.config, compilerBackend: "docker" }, {
    modules: [
      { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
      { id: "030-c-compiler", lane: "C", order: 30, register, migrations },
    ],
  });
  const done = Promise.withResolvers<void>();
  const deadline = setTimeout(() => done.reject(new Error("Quiescence event missing")), 15000);
  let unsubscribe = () => {};
  try {
    await seed(runtime, "quiescence-regression-password");
    const compiler = runtime.services.get("compiler");
    if (!(compiler instanceof CompilerService)) throw new TypeError("Expected actual compiler");
    const idsToCancel = [IdSchema.parse(crypto.randomUUID()), IdSchema.parse(crypto.randomUUID())];
    for (const [index, id] of idsToCancel.entries()) {
      await runtime.db.run(`INSERT INTO compile_jobs
        (id,actor_id,snapshot_id,environment_id,settings_json,status,queued_at,idempotency_key,queue_order)
        VALUES(?,?,?,?,?,'queued',?,?,?)`, [id, ids.kien, ids.snapshot, ids.environment,
        JSON.stringify(settings), runtime.clock.now(), `quiescence-${index}`, index + 1]);
      await runtime.db.run("INSERT INTO compiler_requests(job_id,digest,clean,limits_json,cache_key) VALUES(?,?,1,?,NULL)",
        [id, id, JSON.stringify(defaultLimits)]);
    }
    const leases = new CompilerLeases(compiler);
    const lease = await leases.lease(ids.operator, [ids.environment]);
    if (!lease) throw new TypeError("Expected real worker lease");
    unsubscribe = runtime.events.subscribe(event => {
      if (event.topic === "job.changed" && event.payload.resourceId === lease.jobId && event.payload.status === "canceled") done.resolve();
    });
    await runtime.admission.exclusive(() => quiesceCompiler(runtime));
    await done.promise;
    for (const id of idsToCancel) {
      expect(await compiler.store.get(id)).toMatchObject({ status: "canceled", failureCode: "BACKUP_QUIESCED" });
    }
    const late = await leases.fence(lease.jobId, lease).then(() => null, (error: unknown) => error);
    expect(late).toMatchObject({ code: "STALE_LEASE" });
    expect(await runtime.db.get("SELECT job_id FROM worker_leases")).toBeNull();
  } finally {
    clearTimeout(deadline); unsubscribe();
    await stopWorker(runtime);
    await runtime.close();
  }
}, 30000);
