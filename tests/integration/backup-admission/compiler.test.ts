import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { IdSchema, WorkerLeaseSchema } from "@quire/contracts";
import { loadConfig } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import { CompilerLeases, CompilerService } from "../../../services/compiler";
import { configureBackups, createBackup, verifyBackup } from "../../../services/operations/backups";
import { backupHost } from "../../../services/operations/backups/model";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";
import { bounded } from "../portable/process";

test("the composed host drains an in-flight worker artifact and fences running and queued compiler jobs", async () => {
  // Given actual compiler/source services, a real worker lease and an HTTP artifact upload.
  await using resources = new AsyncDisposableStack();
  const root = await mkdtemp(join(tmpdir(), "quire-backup-compiler-"));
  resources.defer(() => rm(root, { recursive: true, force: true }));
  const app = await createApplication({ config: loadConfig({ QUIRE_DATA_DIR: root }) });
  resources.defer(() => app.close());
  await seed(app.runtime, "quire-backup-compiler-test");
  const service = app.runtime.services.get("compiler");
  if (!(service instanceof CompilerService)) throw new Error("Actual compiler service required");
  const first = await service.enqueue(fixtureIds.kien, {
    scope: { projectId: fixtureIds.project, branch: "main" }, expectedRevision: 0, clean: true,
  }, "backup-running-job");
  const queued = await service.enqueue(fixtureIds.kien, {
    scope: { projectId: fixtureIds.project, branch: "main" }, expectedRevision: 0, clean: true,
  }, "backup-queued-job");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.fetch(request) });
  resources.defer(() => server.stop(true));
  const authorization = `Bearer ${new CompilerLeases(service).bearer()}`;
  const claimed = await fetch(new URL("/internal/workers/lease", server.url), {
    method: "POST", headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ workerId: IdSchema.parse(crypto.randomUUID()), environmentIds: [fixtureIds.environment] }),
  });
  const lease = z.object({ data: z.object({ lease: WorkerLeaseSchema }) }).parse(await claimed.json()).data.lease;
  expect(lease.jobId).toBe(first.id);
  const capability = claimed.headers.get("x-job-capability");
  if (!capability) throw new Error("Worker capability required");
  const bytes = new TextEncoder().encode("artifact admitted before backup");
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  resources.defer(() => { release.resolve(); });
  const put = app.runtime.blobs.put.bind(app.runtime.blobs);
  app.runtime.blobs.put = async content => {
    if (Buffer.from(content).equals(Buffer.from(bytes))) { entered.resolve(); await release.promise; }
    return put(content);
  };
  resources.defer(() => { app.runtime.blobs.put = put; });
  const upload = () => fetch(new URL(`/internal/jobs/${lease.jobId}/artifacts/build.log?attempt=${lease.attempt}&fencingToken=${lease.fencingToken}`, server.url), {
    method: "PUT", headers: { authorization, "x-job-capability": capability, "if-match": `"v${lease.fencingToken}"`,
      "content-type": "application/octet-stream", "x-content-sha256": digest }, body: bytes,
  });
  const uploading = upload();
  await bounded(Promise.race([entered.promise, uploading.then(response => {
    throw new Error(`Worker upload exited before its barrier: ${response.status}`);
  })]));
  const closed = Promise.withResolvers<void>();
  const host = backupHost(app.runtime);
  configureBackups(app.runtime, { ...host, exclusive: work => {
    const snapshot = host.exclusive(work);
    closed.resolve();
    return snapshot;
  } });

  // When backup closes admission while the actual upload is still in progress.
  const backup = createBackup(app.runtime);
  try {
    await Promise.race([closed.promise, backup]);
    const heartbeat = () => fetch(new URL(`/internal/jobs/${lease.jobId}/heartbeat`, server.url), {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ attempt: lease.attempt, fencingToken: lease.fencingToken }),
    });
    expect((await heartbeat()).status).toBe(503);
    release.resolve();
    expect((await uploading).status).toBe(200);
    const archive = await backup;
    const verified = await verifyBackup(archive.destination, app.runtime.secretKey, host.signingKey);
    const jobs = verified.database.tables.find(table => table.name === "compile_jobs")?.rows;

    // Then the drained artifact is preserved, both jobs are terminal, and old callbacks are fenced.
    for (const id of [first.id, queued.id]) {
      expect(jobs?.find(job => job["id"] === id)).toMatchObject({ status: "canceled", failure_code: "BACKUP_QUIESCED" });
    }
    expect(verified.database.tables.find(table => table.name === "worker_leases")?.rows).toEqual([]);
    expect(verified.database.tables.find(table => table.name === "artifacts")?.rows.some(row => row["sha256"] === digest)).toBe(true);
    expect((await heartbeat()).status).toBe(409);
    expect((await upload()).status).toBe(409);
  } finally { release.resolve(); await uploading; await backup; }
}, 300000);
