import { test, expect } from "bun:test";
import { strict as assert } from "node:assert";
import { compilerFixture, terminalEvent, fixtureIds as ids, settings } from "./fixtures";
import { pdfText } from "./pdf-text";
import { CompilerLeases } from "../../services/compiler/leases";
import { CompilerService } from "../../services/compiler/service";
import { EnvironmentSchema, InstantSchema } from "@quire/contracts";
import { z } from "zod";
import { ServiceError } from "@quire/runtime";

test("T08 immutable snapshots and failed jobs preserve the last successful PDF", async () => {
  // Given a source snapshot and a subscribed real local worker.
  await using runtime = await compilerFixture();
  const snapshot = await runtime.replaceSnapshot("\\documentclass{article}\\begin{document}\nImmutable original.\n\\end{document}");
  const done = terminalEvent(runtime);
  const compiler = runtime.services.get("compiler");
  const job = await compiler.enqueue(ids.kien, { scope: snapshot.scope, expectedRevision: snapshot.revision, settings, clean: false }, "original");
  await runtime.replaceSnapshot("\\documentclass{article}\\begin{document}\n\\unknownOwnedCommand\n\\end{document}");
  await runtime.start();
  // When the captured snapshot compiles while the current source has already changed.
  await done;
  const successful = await compiler.get(ids.kien, job.id);
  const pdf = successful.artifacts.find((item) => item.name === "output.pdf");
  if (!pdf) throw new TypeError("Expected successful PDF");
  // Then its bytes are from the captured source.
  expect(await pdfText(await runtime.blobs.get(pdf.sha256))).toContain("Immutable original");
  const failedDone = terminalEvent(runtime);
  const failed = await compiler.enqueue(ids.kien, { scope: snapshot.scope, expectedRevision: snapshot.revision + 1, settings, clean: true }, "failure");
  await failedDone;
  const failedJob = await compiler.get(ids.kien, failed.id);
  expect(failedJob.status).toBe("failed");
  expect(failedJob.diagnostics.some((item) => item.fileId === ids.mainFile && item.line === 2)).toBe(true);
  const preview = z.object({ artifact_id: z.string() }).parse((await runtime.db.get("SELECT artifact_id FROM compiler_previews", [])));
  expect(preview.artifact_id).toBe(pdf.id);
  expect(failedJob.artifacts.some((item) => item.kind === "log")).toBe(true);
}, 60000);

test("T08 idempotency rejects changed requests and unauthorized actors", async () => {
  // Given a real seeded immutable snapshot with the independent ACL fixture.
  await using runtime = await compilerFixture();
  const compiler = runtime.services.get("compiler");
  const request = { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, settings, clean: false };
  const original = await compiler.enqueue(ids.kien, request, "same-key");
  // When replaying the same key or attempting a different request.
  const replay = await compiler.enqueue(ids.kien, request, "same-key");
  // Then identical replay is stable, differing input and forbidden actor are rejected.
  expect(replay.id).toBe(original.id);
  const conflict = await compiler.enqueue(ids.kien, { ...request, clean: true }, "same-key").catch((error: unknown) => {
    if (error instanceof ServiceError) return error.code; throw error;
  });
  const forbidden = await compiler.get(ids.outsider, original.id).catch((error: unknown) => {
    if (error instanceof ServiceError) return error.code; throw error;
  });
  expect(conflict).toBe("IDEMPOTENCY_CONFLICT");
  expect(forbidden).toBe("FORBIDDEN");
}, 60000);

test("T08 worker lease expiry fences late completion with injected clock", async () => {
  // Given a queued real job and an explicit lease.
  await using runtime = await compilerFixture();
  const compiler = runtime.services.get("compiler");
  await compiler.enqueue(ids.kien, { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, settings, clean: false }, "lease");
  const environmentRow = z.object({ manifest_json: z.string() }).parse((await runtime.db.get("SELECT manifest_json FROM environments WHERE id=?", [ids.environment])));
  let now = Date.parse(runtime.clock.now());
  const service = new CompilerService({ ...runtime, clock: { now: () => InstantSchema.parse(new Date(now).toISOString()) }, routes: runtime.routes.forLane("C") },
    EnvironmentSchema.parse(JSON.parse(environmentRow.manifest_json)));
  const leases = new CompilerLeases(service);
  const lease = await leases.lease(ids.operator, [ids.environment]);
  if (!lease) throw new TypeError("Lease missing");
  // When the injected clock passes the lease deadline.
  now += 31000;
  await leases.reap();
  // Then stale worker writes are rejected independently of process timing.
  expect((await runtime.store.get(lease.jobId)).failureCode).toBe("WORKER_LEASE_EXPIRED");
  await assert.rejects(leases.fence(lease.jobId, lease), { code: "STALE_LEASE" });
}, 60000);

test("T08 a real runaway TeX job reaches durable timeout state", async () => {
  // Given a real source loop and a project policy with one second of wall time.
  await using runtime = await compilerFixture({ wallSeconds: 1 });
  const snapshot = await runtime.replaceSnapshot("\\documentclass{article}\\begin{document}\\loop\\iftrue\\repeat\\end{document}");
  const compiler = runtime.services.get("compiler");
  const done = terminalEvent(runtime);
  const job = await compiler.enqueue(ids.kien, { scope: snapshot.scope, expectedRevision: snapshot.revision,
    settings, clean: true }, "real-timeout");
  // When the actual worker executes this source.
  await runtime.start();
  await done;
  // Then the durable job reports the real wall-limit result, not generic failure.
  const complete = await compiler.get(ids.kien, job.id);
  expect(complete.status).toBe("timeout");
  expect(complete.failureCode).toBe("WALL_LIMIT");
  expect(complete.artifacts.some((item) => item.kind === "pdf")).toBe(false);
}, 90000);

test("T08 late completion cannot replace a newer successful preview", async () => {
  // Given two actually compiled revisions and the newer preview.
  await using runtime = await compilerFixture();
  const compiler = runtime.services.get("compiler");
  if (!(compiler instanceof CompilerService)) throw new TypeError("Compiler module was not registered");
  await runtime.start();
  const oldSnapshot = await runtime.replaceSnapshot("\\documentclass{article}\\begin{document}Older revision.\\end{document}");
  const firstDone = terminalEvent(runtime);
  const first = await compiler.enqueue(ids.kien, { scope: oldSnapshot.scope, expectedRevision: oldSnapshot.revision, settings, clean: true }, "old-preview");
  await firstDone;
  const newSnapshot = await runtime.replaceSnapshot("\\documentclass{article}\\begin{document}Newer revision.\\end{document}");
  const secondDone = terminalEvent(runtime);
  const second = await compiler.enqueue(ids.kien, { scope: newSnapshot.scope, expectedRevision: newSnapshot.revision, settings, clean: true }, "new-preview");
  await secondDone;
  const newerPdf = (await runtime.store.get(second.id)).artifacts.find((artifact) => artifact.name === "output.pdf");
  if (!newerPdf) throw new TypeError("Newer PDF missing");
  // When completion publication arrives in the opposite order.
  await runtime.uow.run(async tx => { await tx.lock("quire:compiler"); await compiler.publishPreview(tx, first.id); });
  // Then the preview still identifies the newer actual PDF.
  expect(z.object({ artifact_id: z.string() }).parse((await runtime.db.get("SELECT artifact_id FROM compiler_previews", []))).artifact_id).toBe(newerPdf.id);
}, 90000);
