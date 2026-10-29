import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CompileJobSchema, EnvironmentSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { systemClock } from "@quire/runtime";
import { fixtureIds } from "../../fixtures/foundation";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { RedisNotificationTransport } from "../../../services/operations/storage/redis";
import { RemoteRepositoryService } from "../../../services/operations/repository";
import { assertInstallationDatabase } from "../../../services/operations/installation/binding";
import { InstallationStateSchema } from "../../../services/operations/installation/model";
import type { InstallationBinding } from "../../../services/operations/installation/model";
import { ExecutionLaunchSchema } from "../../../services/operations/installation/execution-model";
import { nativeInstallation, origin, password } from "./native-fixture";
import { installationScaleResources } from "./scale-resources";

async function login(port: number, email: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected actual authenticated cookie");
  const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie, origin }, signal: AbortSignal.timeout(10000) });
  return { cookie, origin, "x-csrf-token": z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken };
}
async function compile(port: number, binding: InstallationBinding, headers: Record<string, string>) {
  if (binding.data.dialect !== "postgres") throw new Error("Scale proof must use PostgreSQL");
  const data = binding.data;
  const storage = await createPostgresStorage({ url: (await readFile(data.database.connectionSecretRef, "utf8")).trim() });
  const transport = new RedisNotificationTransport({
    url: (await readFile(data.redis.connectionSecretRef, "utf8")).trim(), namespace: data.redis.namespace,
  });
  const finished = Promise.withResolvers<void>();
  void finished.promise.catch(() => undefined);
  let jobId: Id | null = null;
  let pending = false;
  let dirty = false;
  const check = async () => {
    if (jobId === null) return;
    if (pending) { dirty = true; return; }
    pending = true;
    try {
      do {
        dirty = false;
        const row = z.object({ status: z.string() }).parse(await storage.db.get("SELECT status FROM compile_jobs WHERE id=?", [jobId]));
        if (!["queued", "running"].includes(row.status)) { finished.resolve(); return; }
      } while (dirty);
    } catch (error) { finished.reject(error); }
    finally { pending = false; }
  };
  const unsubscribe = transport.subscribeEvents(() => { void check(); });
  const timeout = setTimeout(() => finished.reject(new Error("Actual scale compile event timed out")), 180000);
  try {
    await assertInstallationDatabase(storage.db, data.database.identity);
    await transport.connect();
    const accepted = await fetch(`http://127.0.0.1:${port}/api/projects/${fixtureIds.project}/compiles`, {
      method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope: { projectId: fixtureIds.project, branch: "main" }, expectedRevision: 0, clean: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (accepted.status !== 202) throw new Error(`Scale compile admission ${accepted.status}: ${await accepted.text()}`);
    jobId = z.object({ data: CompileJobSchema }).parse(await accepted.json()).data.id;
    await check();
    await finished.promise;
    const response = await fetch(`http://127.0.0.1:${port}/api/compiles/${jobId}`, { headers, signal: AbortSignal.timeout(10000) });
    const job = z.object({ data: CompileJobSchema }).parse(await response.json()).data;
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    expect(job.workerId).not.toBeNull();
    const pdf = job.artifacts.find(artifact => artifact.name === "output.pdf");
    if (!pdf) throw new Error("Actual scale worker produced no PDF artifact");
    const content = await fetch(`http://127.0.0.1:${port}/api/artifacts/${pdf.id}/content`, { headers, signal: AbortSignal.timeout(10000) });
    expect(content.status).toBe(200);
    expect(new TextDecoder().decode((await content.bytes()).subarray(0, 5))).toBe("%PDF-");
    return job;
  } finally {
    clearTimeout(timeout); unsubscribe();
    await transport.close(); await storage.close();
  }
}
async function source(port: number, headers: HeadersInit) {
  const response = await fetch(`http://127.0.0.1:${port}/api/projects/${fixtureIds.project}/files/${fixtureIds.mainFile}/content?branch=main`,
    { headers, signal: AbortSignal.timeout(10000) });
  expect(response.status).toBe(200);
  return response.bytes();
}
async function refs(binding: InstallationBinding) {
  if (binding.data.dialect !== "postgres") throw new Error("Expected concrete scale binding");
  const service = new RemoteRepositoryService({ url: binding.data.repository.endpoint, clock: systemClock,
    token: (await readFile(binding.data.repository.credentialsSecretRef, "utf8")).trim() });
  try { return await service.read(fixtureIds.project, ["for-each-ref", "--format=%(refname) %(objectname)"]); }
  finally { await service.close(); }
}
function executions(root: string) {
  const database = new Database(join(root, "control.sqlite"), { readonly: true });
  try {
    database.exec("PRAGMA busy_timeout=5000");
    return z.array(z.object({ record_json: z.string() })).parse(
      database.query("SELECT record_json FROM execution_launches ORDER BY id").all())
      .map(row => ExecutionLaunchSchema.parse(JSON.parse(row.record_json)));
  } finally { database.close(); }
}

test("same-host PostgreSQL S3 Git Redis cohort compiles and rebinds every authority after fresh rollback", async () => {
  const environment = z.array(EnvironmentSchema).parse(JSON.parse(await readFile(
    "docs/evidence/p2o-environments/worker-environments.json", "utf8")))[0];
  if (!environment) throw new Error("Missing accepted immutable environment receipt");
  await using services = await installationScaleResources();
  await using owned = await nativeInstallation({ workerEnvironment: environment, scale: services, candidatePortConflict: true });
  if (!owned.apiPort || owned.prior.data.dialect !== "postgres") throw new Error("SQLite cannot satisfy scale acceptance");
  try {
    await owned.start();
    const user = await login(owned.apiPort, "kien@quire.local");
    const operator = await login(owned.apiPort, "operator@quire.local");
    const first = await compile(owned.apiPort, owned.prior, user);
    const originalSource = await source(owned.apiPort, user);
    const originalRefs = await refs(owned.prior);
    const active = owned.activatedAfter(0);
    const completed = owned.receiptWhen(row => ["succeeded", "failed"].includes(row.operation.status) || row.operation.errorCode !== null);
    void completed.catch(() => undefined);
    const accepted = await fetch(`http://127.0.0.1:${owned.apiPort}/api/admin/updates`, {
      method: "POST", headers: { ...operator, "content-type": "application/json", "idempotency-key": "all-role-scale-health" },
      body: JSON.stringify({ releaseId: owned.release.id, at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false }),
      signal: AbortSignal.timeout(120000),
    });
    expect(accepted.status).toBe(202);
    const receipt = await completed;
    expect(receipt.operation.status, JSON.stringify(receipt.operation)).toBe("failed");
    expect(receipt.operation.result, JSON.stringify(receipt.operation)).toMatchObject({ rolledBack: true });
    await active;
    const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
    expect(state.mode).toBe("open");
    expect(state.floor).toEqual({ sequence: 1, version: "1.0.0" });
    expect(state.binding.release).toEqual(owned.prior.release);
    const restored = state.binding.data;
    if (restored.dialect !== "postgres") throw new Error("Rollback changed the application dialect");
    expect(restored.generationId).not.toBe(owned.prior.data.generationId);
    expect(restored.database.identity).not.toBe(owned.prior.data.database.identity);
    expect(restored.blobs.bucket).not.toBe(owned.prior.data.blobs.bucket);
    expect(restored.repository.volume).not.toBe(owned.prior.data.repository.volume);
    expect(restored.redis.namespace).not.toBe(owned.prior.data.redis.namespace);
    expect(await readFile(restored.applicationSecretRef, "utf8")).toBe(await readFile(owned.prior.data.applicationSecretRef, "utf8"));
    expect(await source(owned.apiPort, user)).toEqual(originalSource);
    expect(await refs(state.binding)).toEqual(originalRefs);
    const second = await compile(owned.apiPort, state.binding, user);
    expect(second.workerId).not.toBe(first.workerId);
    const launches = executions(owned.roots.control);
    expect(launches.some(row => row.binding.data.generationId === restored.generationId &&
      row.request.work.kind === "compile" && row.result?.code === 0)).toBe(true);
    console.info("INSTALLATION_ALL_ROLE_SCALE", JSON.stringify({ prior: owned.prior, state, receipt, launches }));
  } finally {
    console.info("INSTALLATION_ALL_ROLE_SCALE_EXECUTIONS", JSON.stringify(executions(owned.roots.control)));
  }
}, 600000);
