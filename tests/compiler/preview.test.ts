import { test, expect } from "bun:test";
import { z } from "zod";
import { endpoints, GitStatusSchema, OperationSchema } from "@quire/contracts";
import { gitFixture } from "../core/git/harness";
import { fixtureIds as ids, settings } from "./fixtures";
import { compilerHttp } from "./http-fixture";
import { pdfText } from "./pdf-text";
import { retain } from "./evidence";

type App = Awaited<ReturnType<typeof gitFixture>>;
const scope = { projectId: ids.project, branch: "main" } as const;
const path = `/api/projects/${ids.project}/compile-preview`;

async function preview(app: App, headers: HeadersInit, branch = "main") {
  const response = await app.request(`${path}?branch=${encodeURIComponent(branch)}`, { headers });
  expect(response.status, await response.clone().text()).toBe(200);
  return z.object({ data: endpoints.compilePreview.output }).parse(await response.json()).data;
}

async function compile(app: App, branch = "main") {
  const completed = Promise.withResolvers<string>();
  const unsubscribe = app.runtime.events.subscribe(event => {
    if (event.topic === "job.changed" && event.aggregateId === ids.project &&
        ["succeeded", "failed", "timeout", "canceled"].includes(event.payload.status)) {
      completed.resolve(event.payload.resourceId);
    }
  });
  const deadline = setTimeout(() => completed.reject(new TypeError("Preview compile timed out")), 60000);
  try {
    const job = await app.runtime.services.get("compiler").enqueue(ids.kien, {
      scope: { ...scope, branch }, expectedRevision: (await app.service().getBranch({ ...scope, branch })).revision,
      settings: { ...settings, stopOnFirstError: false }, clean: true,
    }, crypto.randomUUID());
    expect(await completed.promise).toBe(job.id);
    return app.runtime.services.get("compiler").get(ids.kien, job.id);
  } finally { clearTimeout(deadline); unsubscribe(); }
}

test("returns nullable discovery when the branch has never compiled", async () => {
  // Given: a real seeded project and owner session.
  await using app = await gitFixture({ compiler: true });
  const owner = await app.login();
  // When: the branch is discovered without knowing a job ID.
  const state = await preview(app, owner.headers);
  // Then: absence is explicit, not a fabricated queued job or PDF.
  expect(state).toEqual({ job: null, preview: null });
}, 60000);

test("discovers the newest queued ordinary job when no PDF exists", async () => {
  // Given: an isolated compiler that has not started its worker.
  await using app = await compilerHttp();
  const owner = await app.login();
  const compiler = app.runtime.services.get("compiler");
  await compiler.enqueue(ids.kien, { scope, expectedRevision: 0, settings, clean: false }, "first");
  const latest = await compiler.enqueue(ids.kien, { scope, expectedRevision: 0, settings, clean: true }, "second");
  // When: discovery is requested after two admissions.
  const response = await app.request(`${path}?branch=main`, { headers: owner });
  const state = z.object({ data: endpoints.compilePreview.output }).parse(await response.json()).data;
  // Then: queue order, rather than tied timestamps or ID order, selects the latest job.
  expect(response.status).toBe(200);
  expect(state.job?.id).toBe(latest.id);
  expect(state.job?.status).toBe("queued");
  expect(state.preview).toBeNull();
}, 60000);

test("recovers the actual successful PDF when the runtime and client reload", async () => {
  // Given: an actual sandboxed compile whose state is committed to disk.
  await using app = await gitFixture({ compiler: true });
  const owner = await app.login();
  const job = await compile(app);
  expect(job.status).toBe("succeeded");
  // When: the old runtime closes and a new runtime opens the same database.
  await app.restart();
  const state = await preview(app, owner.headers);
  // Then: discovery recovers the real PDF and its source snapshot without browser state.
  expect(state.job?.id).toBe(job.id);
  expect(state.preview?.snapshot.id).toBe(job.snapshot.id);
  expect(state.preview?.stale).toBe(false);
  if (!state.preview) throw new TypeError("Successful preview missing");
  const response = await app.request(`/api/artifacts/${state.preview.artifact.id}/content`, { headers: owner.headers });
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(await pdfText(bytes)).toContain("Latent Dynamics");
  await retain("preview-reloaded.pdf", bytes);
  console.info("PREVIEW_RELOAD_PDF", { jobId: job.id, artifactId: state.preview.artifact.id,
    bytes: bytes.length, sha256: state.preview.artifact.sha256 });
}, 90000);

test("marks the PDF stale when source advances without another compile", async () => {
  // Given: a successful PDF and the real core source writer.
  await using app = await gitFixture({ compiler: true });
  const owner = await app.login();
  const job = await compile(app);
  const source = await app.service().readDocument(scope, ids.mainFile);
  await app.service().serialized(scope, async lease => app.service().commitSource({
    actorId: ids.kien, scope, lease, expectedRevision: 0,
    inputs: [{ file: source.file, bytes: new TextEncoder().encode(source.text + "\n% newer source\n") }],
  }));
  // When: current discovery is read without enqueueing any job.
  const state = await preview(app, owner.headers);
  // Then: the previous success remains identified as older than the working source.
  expect(state.job?.id).toBe(job.id);
  expect(state.job?.status).toBe("succeeded");
  expect(state.preview?.snapshot.revision).toBe(0);
  expect(state.preview?.stale).toBe(true);
  const existing = await app.request(`/api/compiles/${job.id}`, { headers: owner.headers });
  expect(existing.headers.get("x-last-successful-artifact-id")).toBe(state.preview?.artifact.id ?? null);
  expect(existing.headers.get("x-preview-stale")).toBe("true");
}, 90000);

test("retains the last good PDF when the newest ordinary compile fails", async () => {
  // Given: a successful PDF followed by a real source edit that introduces a TeX error.
  await using app = await gitFixture({ compiler: true });
  const owner = await app.login();
  const successful = await compile(app);
  const pdf = successful.artifacts.find(artifact => artifact.name === "output.pdf");
  if (!pdf) throw new TypeError("Successful PDF missing");
  const source = await app.service().readDocument(scope, ids.mainFile);
  await app.service().serialized(scope, async lease => app.service().commitSource({
    actorId: ids.kien, scope, lease, expectedRevision: 0, inputs: [{ file: source.file,
      bytes: new TextEncoder().encode("\\documentclass{article}\\begin{document}\\unknownPreviewCommand\\end{document}") }],
  }));
  const failed = await compile(app);
  expect(failed.status).toBe("failed");
  // When: a fresh discovery request follows the failed terminal event.
  const state = await preview(app, owner.headers);
  // Then: the error job is latest, while the separately identified PDF remains the previous success.
  expect(state.job?.id).toBe(failed.id);
  expect(state.job?.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
  expect(state.preview?.artifact.id).toBe(pdf.id);
  expect(state.preview?.snapshot.id).toBe(successful.snapshot.id);
  expect(state.preview?.stale).toBe(true);
  const existing = await app.request(`/api/compiles/${failed.id}`, { headers: owner.headers });
  expect(existing.headers.get("etag")).toMatch(/^"v\d+"$/);
  expect(existing.headers.get("x-last-successful-artifact-id")).toBe(pdf.id);
  expect(existing.headers.get("x-preview-stale")).toBe("true");
}, 90000);

test("isolates ordinary jobs and successful previews by branch", async () => {
  // Given: main has a successful PDF and a real Git branch is independently created.
  await using app = await gitFixture({ compiler: true });
  const owner = await app.login();
  const main = await compile(app);
  const created = await app.request(`/api/projects/${ids.project}/git/branches`, { method: "POST",
    headers: owner.headers, body: JSON.stringify({ name: "topic", from: "main", expectedVersion: 0 }) });
  expect(created.status, await created.clone().text()).toBe(200);
  z.object({ data: GitStatusSchema }).parse(await created.json());
  expect(await preview(app, owner.headers, "topic")).toEqual({ job: null, preview: null });
  const topic = await compile(app, "topic");
  // When: each branch is discovered after both have compiled.
  const [mainState, topicState] = await Promise.all([
    preview(app, owner.headers), preview(app, owner.headers, "topic"),
  ]);
  // Then: neither branch leaks the other's latest job or last successful artifact.
  expect(mainState.job?.id).toBe(main.id);
  expect(mainState.preview?.artifact.jobId).toBe(main.id);
  expect(topicState.job?.id).toBe(topic.id);
  expect(topicState.preview?.artifact.jobId).toBe(topic.id);
  expect(topicState.preview?.snapshot.scope.branch).toBe("topic");
}, 120000);

test("allows Viewer discovery and denies outsiders through current project permissions", async () => {
  // Given: a real successful job and independent Viewer and outsider sessions.
  await using app = await gitFixture({ compiler: true });
  const job = await compile(app);
  const viewer = await app.login("alex@quire.local");
  const outsider = await app.login("outsider@quire.local");
  // When: both users request the same branch.
  const state = await preview(app, viewer.headers);
  const denied = await app.request(`${path}?branch=main`, { headers: outsider.headers });
  // Then: read permission exposes the actual job only to the project member.
  expect(state.job?.id).toBe(job.id);
  expect(state.preview?.artifact.jobId).toBe(job.id);
  expect(denied.status).toBe(404);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await denied.json()).error.code).toBe("NOT_FOUND");
}, 90000);

test("excludes historical PDF-diff jobs from ordinary branch discovery", async () => {
  // Given: a real ordinary success, followed by an actual historical PDF comparison.
  await using app = await gitFixture({ compiler: true });
  const owner = await app.login();
  const job = await compile(app);
  const completed = Promise.withResolvers<string>();
  const unsubscribe = app.runtime.events.subscribe(event => {
    if (event.topic === "operation.changed" && event.aggregateId === ids.project) completed.resolve(event.payload.resourceId);
  });
  const deadline = setTimeout(() => completed.reject(new TypeError("Preview diff timed out")), 60000);
  try {
    const response = await app.request(`/api/projects/${ids.project}/pdf-diffs`, { method: "POST",
      headers: owner.headers, body: JSON.stringify({
        fromSnapshotId: job.snapshot.id, toSnapshotId: job.snapshot.id, mode: "side-by-side",
      }) });
    expect(response.status).toBe(202);
    const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
    expect(await completed.promise).toBe(operation.id);
    const result = z.object({ status: z.string() }).parse(await app.runtime.db.get(
      "SELECT status FROM operations WHERE id=?", [operation.id]));
    expect(result.status).toBe("succeeded");
    // When: discovery is reloaded with newer successful historical jobs present.
    await app.restart();
    const state = await preview(app, owner.headers);
    // Then: only the ordinary job and its published PDF are returned.
    expect(state.job?.id).toBe(job.id);
    expect(state.preview?.artifact.jobId).toBe(job.id);
    expect(state.preview?.stale).toBe(false);
    expect(z.object({ count: z.number() }).parse(await app.runtime.db.get(
      "SELECT count(*) AS count FROM compiler_requests WHERE preview=0")).count).toBe(2);
  } finally { clearTimeout(deadline); unsubscribe(); }
}, 120000);
