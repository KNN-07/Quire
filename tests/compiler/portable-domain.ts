import { strict as assert } from "node:assert";
import { z } from "zod";
import { WorkerLeaseSchema, IdSchema } from "@quire/contracts";
import { CompilerService, CompilerLeases } from "../../services/compiler";
import { build } from "../../workers/compiler/build";
import type { compilerHttp } from "./http-fixture";
import { fixtureIds as ids, settings, sourceFixture } from "./fixtures";

export async function portableCompilerDomain(app: Awaited<ReturnType<typeof compilerHttp>>): Promise<void> {
  const service = app.runtime.services.get("compiler");
  if (!(service instanceof CompilerService)) throw new TypeError("Compiler service missing");
  const request = { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, settings, clean: true };
  const headers = { authorization: `Bearer ${new CompilerLeases(service).bearer()}` };
  const enqueue = (key: string, clean = true) => service.enqueue(ids.kien, { ...request, clean }, key);
  const claim = async (workerId = ids.operator) => {
    const response = await app.request("/internal/workers/lease", {
      method: "POST", headers, body: JSON.stringify({ workerId, environmentIds: [ids.environment] }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return {
      lease: z.object({ data: z.object({ lease: WorkerLeaseSchema.nullable() }) }).parse(await response.json()).data.lease,
      capability: response.headers.get("x-job-capability"),
    };
  };
  const jobs = await Promise.all([enqueue("atomic-admission"), enqueue("atomic-admission")]);
  assert.equal(jobs[0]?.id, jobs[1]?.id);
  const claims = await Promise.all([claim(), claim(ids.mai)]);
  assert.equal(claims.filter(item => item.lease).length, 1);
  const selected = claims.find(item => item.lease);
  assert(selected?.lease);
  const lease = selected.lease;
  await assert.rejects(new CompilerLeases(service).heartbeat(lease.jobId, {
    attempt: lease.attempt + 1, fencingToken: lease.fencingToken,
  }), { code: "STALE_LEASE" });
  const query = `attempt=${lease.attempt}&fencingToken=${lease.fencingToken}`;
  const uploadHeaders = {
    ...headers, "x-job-capability": selected.capability ?? "", "if-match": `"v${lease.fencingToken}"`,
  };

  // Blob upload is outside SQL. Cancellation commits while that upload is held;
  // publication must recheck the lease inside the actual reference transaction.
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const put = app.runtime.blobs.put.bind(app.runtime.blobs);
  const bytes = new TextEncoder().encode("late-artifact-owned-marker");
  app.runtime.blobs.put = async value => {
    if (Buffer.from(value).equals(Buffer.from(bytes))) { entered.resolve(); await release.promise; }
    return put(value);
  };
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  let uploading: Promise<Response> | undefined;
  try {
    uploading = app.request(`/internal/jobs/${lease.jobId}/artifacts/build.log?${query}`, {
      method: "PUT", headers: { ...uploadHeaders, "x-content-sha256": digest }, body: bytes,
    });
    await Promise.race([entered.promise, uploading.then(response => {
      throw new Error(`Artifact request exited before the upload barrier: ${response.status}`);
    })]);
    await service.cancel(ids.kien, lease.jobId);
    release.resolve();
    assert.equal((await uploading).status, 409);
  } finally {
    release.resolve();
    if (uploading) await uploading;
    app.runtime.blobs.put = put;
  }
  assert.equal((await service.store.get(lease.jobId)).artifacts.length, 0);
  assert.equal(await app.runtime.db.get("SELECT digest FROM blobs WHERE digest=?", [digest]), null);
  assert.equal(await app.runtime.db.get("SELECT job_id FROM worker_leases WHERE job_id=?", [lease.jobId]), null);
  await assert.rejects(new CompilerLeases(service).heartbeat(lease.jobId, lease), { code: "STALE_LEASE" });

  // A heartbeat waiting to enter SQL must use the clock inside the transaction.
  const expired = await enqueue("expired-heartbeat");
  const expiryClaim = await claim();
  assert(expiryClaim.lease);
  await app.runtime.db.run("UPDATE worker_leases SET expires_at=? WHERE job_id=?", ["2000-01-01T00:00:00.000Z", expired.id]);
  await assert.rejects(new CompilerLeases(service).heartbeat(expired.id, expiryClaim.lease), { code: "STALE_LEASE" });
  await new CompilerLeases(service).reap();
  assert.equal((await service.store.get(expired.id)).failureCode, "WORKER_LEASE_EXPIRED");

  const canceling = await enqueue("cancel-completion");
  const cancelClaim = await claim();
  assert(cancelClaim.lease);
  const snapshotEntered = Promise.withResolvers<void>(), snapshotRelease = Promise.withResolvers<void>();
  const projects = app.runtime.services.get("projects");
  const readSnapshot = projects.readSnapshot.bind(projects);
  projects.readSnapshot = async id => {
    snapshotEntered.resolve();
    await snapshotRelease.promise;
    return readSnapshot(id);
  };
  let completing: Promise<Response> | undefined;
  try {
    completing = app.request(`/internal/jobs/${canceling.id}/complete`, {
      method: "POST", headers: { ...headers, "idempotency-key": "cancel-complete" },
      body: JSON.stringify({ attempt: cancelClaim.lease.attempt, fencingToken: cancelClaim.lease.fencingToken,
        status: "failed", diagnostics: [], artifactIds: [], elapsedMs: 0, failureCode: "OWNED" }),
    });
    await Promise.race([snapshotEntered.promise, completing.then(response => {
      throw new Error(`Completion exited before the snapshot barrier: ${response.status}`);
    })]);
    await service.cancel(ids.kien, canceling.id);
    snapshotRelease.resolve();
    assert.equal((await completing).status, 409);
  } finally {
    snapshotRelease.resolve();
    if (completing) await completing;
    projects.readSnapshot = readSnapshot;
  }
  assert.equal((await service.store.get(canceling.id)).status, "canceled");
  assert.equal(await app.runtime.db.get("SELECT job_id FROM compiler_completions WHERE job_id=?", [canceling.id]), null);

  // Final publication consists of job/diagnostics/preview/worker/lease/receipt/event
  // in one real transaction. Inject an event failure, then replay concurrently.
  const job = await enqueue("atomic-publication");
  const publicationClaim = await claim();
  assert(publicationClaim.lease);
  const publication = publicationClaim.lease;
  const compiled = await build({
    ...sourceFixture("\\documentclass{article}\\begin{document}Atomic publication.\\end{document}"), settings,
  });
  const pdf = compiled.files.get("output.pdf");
  assert(pdf, compiled.log);
  const pdfResponse = await app.request(`/internal/jobs/${job.id}/artifacts/output.pdf?attempt=${publication.attempt}&fencingToken=${publication.fencingToken}`, {
    method: "PUT", body: new Uint8Array(pdf), headers: {
      ...headers, "x-job-capability": publicationClaim.capability ?? "", "if-match": `"v${publication.fencingToken}"`,
      "x-content-sha256": new Bun.CryptoHasher("sha256").update(pdf).digest("hex"),
    },
  });
  assert.equal(pdfResponse.status, 200, await pdfResponse.clone().text());
  const artifactId = z.object({ data: z.object({ id: IdSchema }) }).parse(await pdfResponse.json()).data.id;
  const body = JSON.stringify({
    attempt: publication.attempt, fencingToken: publication.fencingToken, status: "succeeded",
    diagnostics: [{
      id: crypto.randomUUID(), jobId: job.id, severity: "warning", message: "Owned diagnostic",
      fileId: ids.mainFile, line: 1, column: 0, rawStart: 0, rawEnd: 1,
    }],
    artifactIds: [artifactId], elapsedMs: 1, failureCode: null,
  });
  const complete = () => app.request(`/internal/jobs/${job.id}/complete`, {
    method: "POST", headers: { ...headers, "idempotency-key": "atomic-complete" }, body,
  });
  const record = app.runtime.events.record.bind(app.runtime.events);
  app.runtime.events.record = async (tx, event) => {
    if (event.topic === "job.changed" && "status" in event.payload && event.payload.status === "succeeded") throw new Error("Owned publication rollback");
    return record(tx, event);
  };
  try { assert.equal((await complete()).status, 500); }
  finally { app.runtime.events.record = record; }
  assert.equal((await service.store.get(job.id)).status, "running");
  assert.equal((await service.store.get(job.id)).diagnostics.length, 0);
  assert(await app.runtime.db.get("SELECT job_id FROM worker_leases WHERE job_id=?", [job.id]));
  assert.equal(await app.runtime.db.get("SELECT job_id FROM compiler_completions WHERE job_id=?", [job.id]), null);
  assert.equal(await app.runtime.db.get("SELECT artifact_id FROM compiler_previews"), null);
  const completed = await Promise.all([complete(), complete()]);
  for (const response of completed) assert.equal(response.status, 200, await response.clone().text());
  const receipt = z.object({ data: z.object({ ok: z.literal(true), version: z.number() }) });
  assert.deepEqual(receipt.parse(await completed[0]?.json()).data, receipt.parse(await completed[1]?.json()).data);
  assert.equal((await service.store.get(job.id)).status, "succeeded");
  assert.equal((await service.store.get(job.id)).diagnostics[0]?.column, 0);
  assert.equal((await service.store.raw(job.id)).version, publication.attempt + 2);
  assert.equal(z.object({ artifact_id: IdSchema }).parse(await app.runtime.db.get("SELECT artifact_id FROM compiler_previews")).artifact_id, artifactId);
  assert.equal(await app.runtime.db.get("SELECT job_id FROM worker_leases WHERE job_id=?", [job.id]), null);
  assert.equal((await app.runtime.events.read(0, { aggregateId: ids.project })).filter(event =>
    event.topic === "job.changed" && event.payload.resourceId === job.id && event.payload.status === "succeeded").length, 1);
  await assert.rejects(new CompilerLeases(service).heartbeat(job.id, publication), { code: "STALE_LEASE" });
  const conflict = await app.request(`/internal/jobs/${job.id}/complete`, {
    method: "POST", headers: { ...headers, "idempotency-key": "changed" }, body,
  });
  assert.equal(conflict.status, 409);
  const cached = await enqueue("remote-cache-hit", false);
  assert.equal((await claim()).lease, null);
  const cacheHit = await service.store.get(cached.id);
  assert.equal(cacheHit.status, "succeeded");
  assert.equal(cacheHit.workerId, null);
  assert.equal(cacheHit.artifacts[0]?.sha256, (await service.store.get(job.id)).artifacts[0]?.sha256);
  assert.notEqual(cacheHit.artifacts[0]?.id, artifactId);
  assert.equal(cacheHit.diagnostics[0]?.jobId, cached.id);
  assert.equal(await app.runtime.db.get("SELECT job_id FROM worker_leases WHERE job_id=?", [cached.id]), null);
  console.info("compiler.portable.domain.pass", { dialect: app.runtime.db.dialect, atomicClaims: true, staleArtifact: true, atomicPublication: true, replay: true });
}
