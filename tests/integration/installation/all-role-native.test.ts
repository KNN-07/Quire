import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CompileJobSchema, EnvironmentSchema, IdSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { InstallationStateSchema } from "../../../services/operations/installation/model";
import { ExecutionLaunchSchema } from "../../../services/operations/installation/execution-model";
import { cgroupPids, inspectUnit } from "../../../services/operations/installation/systemd-process";
import { nativeInstallation, origin, password } from "./native-fixture";

function sql<T>(root: string, file: string, run: (database: Database) => T): T {
  const database = new Database(join(root, file), { readonly: true });
  try {
    database.exec("PRAGMA busy_timeout=5000");
    return run(database);
  } finally { database.close(); }
}
function databaseEvent<T>(root: string, select: () => T | null) {
  const result = Promise.withResolvers<T>();
  const observer = watch(root, (_event, file) => { if (file?.startsWith("quire.sqlite")) check(); });
  const timer = setTimeout(() => result.reject(new Error("Actual application SQL event timed out")), 180000);
  const close = () => { observer.close(); clearTimeout(timer); };
  void result.promise.then(close, close);
  void result.promise.catch(() => undefined);
  function check() {
    try { const value = select(); if (value !== null) result.resolve(value); }
    catch (error) { result.reject(error); }
  }
  check();
  return { promise: result.promise, close, check, reject: result.reject };
}
async function login(port: number, email: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected authenticated cookie");
  const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie, origin }, signal: AbortSignal.timeout(10000) });
  return { cookie, origin, "x-csrf-token": z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken };
}
function workerReady(root: string, controlRoot: string, generation: number) {
  const ready = databaseEvent(root, () => sql(root, "quire.sqlite", database => {
    const row = z.object({ id: IdSchema, pid: z.number() }).nullable().parse(database.query(
      `SELECT p.id,p.pid FROM o_worker_processes p JOIN workers w ON w.id=p.id
       WHERE p.exited_at IS NULL AND p.pid IS NOT NULL AND w.state IN ('idle','busy')`).get());
    return row;
  }));
  const failed = watch(controlRoot, (_event, file) => {
    if (!file?.startsWith("control.sqlite")) return;
    try {
      const interrupted = executions(controlRoot).find(row => row.generation === generation &&
        row.request.work.kind === "worker" && row.result?.interrupted);
      if (interrupted) ready.reject(new Error(`Actual worker execution interrupted: ${interrupted.unit}`));
    } catch (error) { ready.reject(error); }
  });
  const close = () => { failed.close(); ready.close(); };
  void ready.promise.then(close, close);
  return { promise: ready.promise, close };
}
async function compile(port: number, root: string, headers: Record<string, string>) {
  let jobId: string | null = null;
  const finished = databaseEvent(root, () => {
    if (jobId === null) return null;
    return sql(root, "quire.sqlite", database => {
      const row = z.object({ status: z.string(), failure_code: z.string().nullable() }).parse(
        database.query("SELECT status,failure_code FROM compile_jobs WHERE id=?").get(jobId));
      return ["queued", "running"].includes(row.status) ? null : row;
    });
  });
  try {
    const accepted = await fetch(`http://127.0.0.1:${port}/api/projects/${fixtureIds.project}/compiles`, {
      method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope: { projectId: fixtureIds.project, branch: "main" }, expectedRevision: 0, clean: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (accepted.status !== 202) throw new Error(`Compile admission ${accepted.status}: ${await accepted.text()}`);
    const job = z.object({ data: CompileJobSchema }).parse(await accepted.json()).data;
    jobId = job.id;
    finished.check();
    expect(await finished.promise).toEqual({ status: "succeeded", failure_code: null });
    const response = await fetch(`http://127.0.0.1:${port}/api/compiles/${job.id}`, { headers, signal: AbortSignal.timeout(10000) });
    const actual = z.object({ data: CompileJobSchema }).parse(await response.json()).data;
    const pdf = actual.artifacts.find(artifact => artifact.name === "output.pdf");
    if (!pdf) throw new Error("Actual worker produced no PDF artifact");
    const content = await fetch(`http://127.0.0.1:${port}/api/artifacts/${pdf.id}/content`, { headers, signal: AbortSignal.timeout(10000) });
    expect(content.status).toBe(200);
    expect(new TextDecoder().decode((await content.bytes()).subarray(0, 5))).toBe("%PDF-");
    expect(actual.workerId).not.toBeNull();
    return actual;
  } finally { finished.close(); }
}
function executions(root: string) {
  return sql(root, "control.sqlite", database => {
    // The subscription precedes controller startup and its additive migration.
    if (!database.query("SELECT name FROM sqlite_master WHERE name='execution_launches'").get()) return [];
    return z.array(z.object({ record_json: z.string() }))
      .parse(database.query("SELECT record_json FROM execution_launches ORDER BY id").all())
      .map(row => ExecutionLaunchSchema.parse(JSON.parse(row.record_json)));
  });
}

for (const rollback of [true, false]) test(`configured native API/SSH/controller cohort owns real workers and compiler containers through ${rollback ? "fresh rollback" : "signed promotion"}`, async () => {
  const accepted = z.array(EnvironmentSchema).parse(JSON.parse(await readFile(
    "docs/evidence/p2o-environments/worker-environments.json", "utf8")));
  const environment = accepted[0];
  if (!environment) throw new Error("Missing accepted immutable environment receipt");
  await using owned = await nativeInstallation({ workerEnvironment: environment, candidatePortConflict: rollback });
  if (!owned.apiPort || !owned.sshPort || owned.prior.data.dialect !== "sqlite") throw new Error("Expected native all-role fixture");
  const firstWorker = workerReady(owned.prior.data.dataRoot, owned.roots.control, 0);
  try {
    await owned.start();
    const originalWorker = await firstWorker.promise;
    const user = await login(owned.apiPort, "kien@quire.local");
    const operator = await login(owned.apiPort, "operator@quire.local");
    const first = await compile(owned.apiPort, owned.prior.data.dataRoot, user);
    expect(first.workerId).toBe(originalWorker.id);
    const ssh = await fetch(`http://127.0.0.1:${owned.sshPort}/keys?fingerprint=SHA256:${"a".repeat(43)}`, {
      headers: { authorization: `Bearer ${owned.sshToken}` }, signal: AbortSignal.timeout(10000),
    });
    expect(ssh.status).toBe(200);
    const before = executions(owned.roots.control);
    expect(before.some(row => row.request.work.kind === "worker" && row.state === "running")).toBe(true);
    expect(before.some(row => row.request.work.kind === "compile" && row.result?.code === 0)).toBe(true);
    const active = owned.activatedAfter(0);
    const completed = owned.receiptWhen(row => ["succeeded", "failed"].includes(row.operation.status) || row.operation.errorCode !== null);
    void completed.catch(() => undefined);
    const scheduled = await fetch(`http://127.0.0.1:${owned.apiPort}/api/admin/updates`, {
      method: "POST", headers: { ...operator, "content-type": "application/json", "idempotency-key": "all-role-native-health" },
      body: JSON.stringify({ releaseId: owned.release.id, at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false }),
      signal: AbortSignal.timeout(120000),
    });
    expect(scheduled.status).toBe(202);
    const receipt = await completed;
    if (rollback) expect(receipt.operation.result).toMatchObject({ rolledBack: true });
    else expect(receipt.operation.status, JSON.stringify(receipt.operation)).toBe("succeeded");
    await active;
    const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
    if (rollback) expect(state.binding.release).toEqual(owned.prior.release);
    else {
      expect(state.binding.release.releaseId).toBe(owned.release.id);
      expect(state.floor).toEqual({ sequence: owned.release.sequence, version: owned.release.version });
    }
    if (state.binding.data.dialect !== "sqlite") throw new Error("Expected fresh native generation");
    if (rollback) expect(state.binding.data.generationId).not.toBe(owned.prior.data.generationId);
    else expect(state.binding.data).toEqual(owned.prior.data);
    const nextWorker = workerReady(state.binding.data.dataRoot, owned.roots.control, state.generation);
    try {
      const replacement = await nextWorker.promise;
      expect(replacement.id).not.toBe(originalWorker.id);
      const second = await compile(owned.apiPort, state.binding.data.dataRoot, user);
      expect(second.workerId).toBe(replacement.id);
    } finally { nextWorker.close(); }
    for (const old of before) {
      const unit = await inspectUnit(owned.config, old.unit);
      expect(["inactive", "failed"]).toContain(unit.state);
      if (unit.cgroup) expect(await cgroupPids(unit.cgroup)).toEqual([]);
    }
    console.info("INSTALLATION_ALL_ROLE_NATIVE", JSON.stringify({ rollback, before, after: executions(owned.roots.control), state, receipt }));
  } finally {
    firstWorker.close();
    console.info("INSTALLATION_ALL_ROLE_EXECUTION_INVENTORY", JSON.stringify(executions(owned.roots.control)));
  }
}, 600000);
