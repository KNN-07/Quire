import { test, expect } from "bun:test";
import { z } from "zod";
import { WorkerLeaseSchema } from "@quire/contracts";
import { CompilerService, CompilerLeases } from "../../services/compiler";
import { compilerHttp } from "./http-fixture";
import { fixtureIds as ids, settings, terminalEvent } from "./fixtures";
import { pdfText } from "./pdf-text";

test("T08 external worker leases, downloads immutable source and publishes real artifacts", async () => {
  // Given an actual authenticated coordinator with a real queued core snapshot.
  await using app = await compilerHttp();
  const compiler = app.runtime.services.get("compiler");
  if (!(compiler instanceof CompilerService)) throw new TypeError("Compiler module was not registered");
  const job = await compiler.enqueue(ids.kien, { scope: { projectId: ids.project, branch: "main" },
    expectedRevision: 0, settings: { ...settings, stopOnFirstError: false }, clean: true }, "remote-worker");
  const bearer = new CompilerLeases(compiler).bearer();
  const done = terminalEvent(app.runtime, job.id);
  // When a separate native Bun worker CLI drives the internal HTTP protocol.
  const worker = Bun.spawn([process.execPath, new URL("../../workers/compiler/main.ts", import.meta.url).pathname], {
    env: { ...process.env, QUIRE_COORDINATOR_URL: app.url.toString(), QUIRE_WORKER_BEARER: bearer,
      QUIRE_WORKER_ID: ids.operator, QUIRE_WORKER_ENVIRONMENT_IDS: ids.environment },
    stdout: "ignore", stderr: "pipe",
    });
  const stderr = new Response(worker.stderr).text();
  try {
    await Promise.race([done, worker.exited.then(async (code) => { throw new TypeError(`Worker exited ${code}: ${await stderr}`); })]);
    const complete = await compiler.get(ids.kien, job.id);
    // Then all artifacts came from real confined TeX and the job completed.
    expect(complete.status).toBe("succeeded");
    expect(complete.workerId).toBe(ids.operator);
    const pdf = complete.artifacts.find((item) => item.name === "output.pdf");
    if (!pdf) throw new TypeError("Remote worker produced no PDF");
    expect(await pdfText(await app.runtime.blobs.get(pdf.sha256))).toContain("Latent Dynamics");
    expect((await app.request("/internal/workers/lease", { method: "POST",
      body: JSON.stringify({ workerId: ids.operator, environmentIds: [ids.environment] }) })).status).toBe(401);
  } finally { worker.kill("SIGTERM"); expect(await worker.exited, await stderr).toBe(0); }
}, 180000);

test("T08 internal HTTP source capabilities, heartbeat fences and completion replay are enforced", async () => {
  // Given a genuine queued job and an authenticated worker lease.
  await using app = await compilerHttp();
  const compiler = app.runtime.services.get("compiler");
  if (!(compiler instanceof CompilerService)) throw new TypeError("Compiler module was not registered");
  const job = await compiler.enqueue(ids.kien, { scope: { projectId: ids.project, branch: "main" },
    expectedRevision: 0, settings, clean: true }, "worker-protocol");
  const headers = { authorization: `Bearer ${new CompilerLeases(compiler).bearer()}` };
  const response = await app.request("/internal/workers/lease", { method: "POST", headers,
    body: JSON.stringify({ workerId: ids.operator, environmentIds: [ids.environment] }) });
  const lease = z.object({ data: z.object({ lease: WorkerLeaseSchema }) }).parse(await response.json()).data.lease;
  expect((await app.runtime.events.read(0, { aggregateId: ids.project })).some((event) =>
    event.topic === "job.changed" && event.payload.resourceId === job.id && event.payload.status === "running")).toBe(true);
  const capability = response.headers.get("x-job-capability");
  if (!capability) throw new TypeError("Lease did not return its capability");
  const query = `attempt=${lease.attempt}&fencingToken=${lease.fencingToken}`;
  // When the real internal HTTP protocol receives valid and stale worker messages.
  expect((await app.request(`/internal/jobs/${job.id}/source.zip?${query}`, { headers })).status).toBe(403);
  const source = await app.request(`/internal/jobs/${job.id}/source.zip?${query}`, {
    headers: { ...headers, "x-job-capability": capability } });
  expect(source.status).toBe(200);
  expect(new Uint8Array(await source.arrayBuffer()).subarray(0, 2)).toEqual(new Uint8Array([80, 75]));
  const heartbeat = await app.request(`/internal/jobs/${job.id}/heartbeat`, { method: "POST", headers,
    body: JSON.stringify({ attempt: lease.attempt, fencingToken: lease.fencingToken }) });
  expect(heartbeat.status).toBe(200);
  const bytes = new TextEncoder().encode("not-a-pdf");
  const invalid = await app.request(`/internal/jobs/${job.id}/artifacts/output.pdf?${query}`, { method: "PUT",
    headers: { ...headers, "x-job-capability": capability, "if-match": `"v${lease.fencingToken}"`,
      "x-content-sha256": new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }, body: bytes });
  expect(invalid.status).toBe(422);
  const body = { attempt: lease.attempt, fencingToken: lease.fencingToken, status: "failed",
    diagnostics: [], artifactIds: [], elapsedMs: 1, failureCode: "OWNED_TEST_FAILURE" };
  const completeHeaders = { ...headers, "idempotency-key": "worker-complete" };
  expect((await app.request(`/internal/jobs/${job.id}/complete`, { method: "POST", headers: completeHeaders, body: JSON.stringify(body) })).status).toBe(200);
  // Then identical completion is replayable, while late heartbeats cannot revive the terminal job.
  expect((await app.request(`/internal/jobs/${job.id}/complete`, { method: "POST", headers: completeHeaders, body: JSON.stringify(body) })).status).toBe(200);
  expect((await app.request(`/internal/jobs/${job.id}/heartbeat`, { method: "POST", headers,
    body: JSON.stringify({ attempt: lease.attempt, fencingToken: lease.fencingToken }) })).status).toBe(409);
}, 90000);
