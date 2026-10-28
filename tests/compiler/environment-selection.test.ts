import { expect, test } from "bun:test";
import { z } from "zod";
import { unzipSync } from "fflate";
import { EnvironmentSchema, IdSchema, WorkerLeaseSchema } from "@quire/contracts";
import { CompilerService, CompilerLeases, configureCompilerEnvironments, register, migrations, stopWorker } from "../../services/compiler";
import { createRuntime } from "@quire/runtime";
import { isolatedData } from "../fixtures/runtime";
import { build } from "../../workers/compiler/build";
import { compilerFixture, settings, terminalEvent, fixtureIds as ids } from "./fixtures";
import { compilerHttp } from "./http-fixture";
import { pdfText } from "./pdf-text";

async function alternative(runtime: Awaited<ReturnType<typeof compilerFixture>>) {
  const row = z.object({ manifest_json: z.string() }).parse(
    await runtime.db.get("SELECT manifest_json FROM environments WHERE id=?", [ids.environment]));
  const environment = EnvironmentSchema.parse({
    ...JSON.parse(row.manifest_json), id: crypto.randomUUID(), label: "Alternate verified native manifest",
  });
  await runtime.db.run(`INSERT INTO environments(id,label,release,backend,manifest_json,available,probe_at,created_at)
    VALUES(?,?,?,?,?,1,?,?)`, [environment.id, environment.label, environment.release, environment.backend,
    JSON.stringify(environment), environment.probeAt, runtime.clock.now()]);
  return environment;
}

test("selected environment provider executes the actual immutable source", async () => {
  await using runtime = await compilerFixture();
  const environment = await alternative(runtime);
  const selected: string[] = [];
  configureCompilerEnvironments(runtime, {
    resolve: async id => {
      expect(id).toBe(environment.id);
      return environment;
    },
    build: async input => {
      selected.push(input.environment.id);
      return build(input);
    },
  });
  const snapshot = await runtime.replaceSnapshot("\\documentclass{article}\\begin{document}Selected environment.\\end{document}");
  const done = terminalEvent(runtime);
  const job = await runtime.services.get("compiler").enqueue(ids.kien, {
    scope: snapshot.scope, expectedRevision: snapshot.revision,
    settings: { ...settings, environmentId: environment.id }, clean: true,
  }, "selected-environment");
  await runtime.start();
  await done;
  const complete = await runtime.store.get(job.id);
  expect(complete.status).toBe("succeeded");
  expect(selected).toEqual([environment.id]);
  const pdf = complete.artifacts.find(artifact => artifact.name === "output.pdf");
  if (!pdf) throw new Error("Expected actual PDF");
  expect(await pdfText(await runtime.blobs.get(pdf.sha256))).toContain("Selected environment");
}, 60000);

test("unavailable or mismatched environment providers cannot admit jobs", async () => {
  await using runtime = await compilerFixture();
  const environment = await alternative(runtime);
  const request = { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0,
    settings: { ...settings, environmentId: environment.id }, clean: true };
  for (const manifest of [
    { ...environment, available: false },
    { ...environment, id: IdSchema.parse(crypto.randomUUID()) },
  ]) {
    configureCompilerEnvironments(runtime, { resolve: async () => manifest, build });
    const failure = await runtime.services.get("compiler").enqueue(ids.kien, request, crypto.randomUUID())
      .then(() => null, (error: unknown) => error);
    expect(failure).toMatchObject({ code: "ENVIRONMENT_UNAVAILABLE" });
  }
  expect(await runtime.db.get("SELECT id FROM compile_jobs")).toBeNull();
});

test("remote source manifest contains the job's selected environment", async () => {
  await using app = await compilerHttp();
  const environment = await alternative(app.runtime);
  configureCompilerEnvironments(app.runtime, { resolve: async () => environment, build });
  const compiler = app.runtime.services.get("compiler");
  if (!(compiler instanceof CompilerService)) throw new Error("Expected compiler");
  const job = await compiler.enqueue(ids.kien, {
    scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0,
    settings: { ...settings, environmentId: environment.id }, clean: true,
  }, "selected-remote-environment");
  const headers = { authorization: `Bearer ${new CompilerLeases(compiler).bearer()}` };
  const response = await app.request("/internal/workers/lease", { method: "POST", headers,
    body: JSON.stringify({ workerId: ids.operator, environmentIds: [environment.id] }) });
  const lease = z.object({ data: z.object({ lease: WorkerLeaseSchema }) }).parse(await response.json()).data.lease;
  const capability = response.headers.get("x-job-capability");
  if (!capability) throw new Error("Expected worker capability");
  const archive = await app.request(`/internal/jobs/${job.id}/source.zip?attempt=${lease.attempt}&fencingToken=${lease.fencingToken}`,
    { headers: { ...headers, "x-job-capability": capability } });
  expect(archive.status).toBe(200);
  const bytes = unzipSync(new Uint8Array(await archive.arrayBuffer()))[".quire-worker-manifest.json"];
  if (!bytes) throw new Error("Expected source manifest");
  expect(z.object({ environment: EnvironmentSchema }).parse(JSON.parse(new TextDecoder().decode(bytes))).environment)
    .toEqual(environment);
});

test("Docker-only coordinator starts without falsely advertising a native environment", async () => {
  await using data = await isolatedData();
  const runtime = await createRuntime({ ...data.config, compilerBackend: "docker" }, {
    modules: [{ id: "030-c-compiler", lane: "C", order: 30, register, migrations }],
  });
  try {
    expect(await runtime.db.get("SELECT id FROM environments")).toBeNull();
    const compiler = runtime.services.get("compiler");
    if (!(compiler instanceof CompilerService)) throw new Error("Expected compiler");
    const failure = await compiler.resolveEnvironment(ids.environment).then(() => null, (error: unknown) => error);
    expect(failure).toMatchObject({ code: "ENVIRONMENT_UNAVAILABLE" });
  } finally { await stopWorker(runtime); await runtime.close(); }
});
