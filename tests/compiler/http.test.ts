import { test, expect } from "bun:test";
import { z } from "zod";
import { CompileJobSchema, EnvironmentSchema, parseResourceVersionTag, OperationSchema, IdSchema } from "@quire/contracts";
import { compilerHttp } from "./http-fixture";
import { fixtureIds as ids, terminalEvent, settings } from "./fixtures";
import { pdfText } from "./pdf-text";

test("T07 HTTP compiles a seeded real core snapshot through real account authentication", async () => {
  // Given an ephemeral server with actual account, core and compiler modules.
  await using app = await compilerHttp();
  const headers = await app.login();
  const done = terminalEvent(app.runtime);
  await app.runtime.start();
  // When the browser-facing endpoint admits a compile request.
  const created = await app.request(`/api/projects/${ids.project}/compiles`, { method: "POST",
    headers: { ...headers, "idempotency-key": "http-compile" },
    body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, settings: { ...settings, stopOnFirstError: false }, clean: true }) });
  expect(created.status, await created.clone().text()).toBe(202);
  const job = z.object({ data: CompileJobSchema }).parse(await created.json()).data;
  await done;
  const response = await app.request(`/api/compiles/${job.id}`, { headers });
  const complete = z.object({ data: CompileJobSchema }).parse(await response.json()).data;
  // Then the source snapshot, genuine rendered PDF, raw logs and installed environment are accessible.
  expect(complete.status).toBe("succeeded");
  const pdf = complete.artifacts.find((item) => item.name === "output.pdf");
  if (!pdf) throw new TypeError("Real compiler returned no PDF");
  const content = await app.request(`/api/artifacts/${pdf.id}/content`, { headers });
  expect(content.headers.get("content-type")).toBe("application/pdf");
  expect(await pdfText(new Uint8Array(await content.arrayBuffer()))).toContain("Latent Dynamics");
  const log = await app.request(`/api/compiles/${job.id}/log`, { headers });
  expect(await log.text()).toContain("ha2018world");
  const environment = await app.request("/api/environments", { headers });
  expect(z.object({ data: z.array(EnvironmentSchema) }).parse(await environment.json()).data[0]?.available).toBe(true);
  const outsiderHeaders = await app.login("outsider@quire.local");
  expect((await app.request(`/api/artifacts/${pdf.id}/content`, { headers: outsiderHeaders })).status).toBe(404);
}, 60000);

test("T09 HTTP Viewer reads existing jobs, PDFs, logs and SyncTeX through real core roles", async () => {
  // Given a genuine successful owner compile and a real Viewer session.
  await using app = await compilerHttp();
  const done = terminalEvent(app.runtime);
  await app.runtime.start();
  const job = await app.runtime.services.get("compiler").enqueue(ids.kien,
    { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0,
      settings: { ...settings, stopOnFirstError: false }, clean: true }, "viewer-read");
  await done;
  const headers = await app.login("alex@quire.local");
  const pdf = app.runtime.store.get(job.id).artifacts.find((item) => item.name === "output.pdf");
  if (!pdf) throw new TypeError("Successful compile did not produce a PDF");
  // When the Viewer requests the four read-only compiler surfaces.
  const [existing, content, log, navigation] = await Promise.all([
    app.request(`/api/compiles/${job.id}`, { headers }),
    app.request(`/api/artifacts/${pdf.id}/content`, { headers }),
    app.request(`/api/compiles/${job.id}/log`, { headers }),
    app.request(`/api/compiles/${job.id}/synctex`, { method: "POST", headers,
      body: JSON.stringify({ direction: "forward", fileId: ids.mainFile, line: 11, column: 0 }) }),
  ]);
  // Then read authorization exposes the actual existing output without granting compilation.
  expect(existing.status).toBe(200);
  expect(z.object({ data: CompileJobSchema }).parse(await existing.json()).data.id).toBe(job.id);
  expect(content.status).toBe(200);
  expect(await pdfText(new Uint8Array(await content.arrayBuffer()))).toContain("Latent Dynamics");
  expect(log.status).toBe(200);
  expect(await log.text()).toContain("ha2018world");
  expect(navigation.status).toBe(200);
  expect(z.object({ data: z.array(z.object({ page: z.number().int().positive() })).min(1) })
    .parse(await navigation.json()).data.length).toBeGreaterThan(0);
}, 90000);

test("T10 HTTP returns an asynchronous operation for real snapshot PDF comparison", async () => {
  // Given actual core history and a listener registered before requesting the comparison.
  await using app = await compilerHttp();
  const headers = await app.login();
  const done = Promise.withResolvers<string>();
  const unsubscribe = app.runtime.events.subscribe((event) => {
    if (event.topic === "operation.changed") done.resolve(event.payload.resourceId);
  });
  const deadline = setTimeout(() => done.reject(new TypeError("PDF comparison event timed out")), 60000);
  try {
    // When the browser-facing comparison endpoint accepts two immutable snapshots.
    const response = await app.request(`/api/projects/${ids.project}/pdf-diffs`, { method: "POST",
      headers: { ...headers, "idempotency-key": "http-diff" },
      body: JSON.stringify({ fromSnapshotId: ids.snapshot, toSnapshotId: ids.snapshot, mode: "side-by-side" }) });
    const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
    // Then admission is immediate and the completed operation links actual downloadable artifacts.
    expect(response.status).toBe(202);
    expect(operation.status).toBe("running");
    expect(await done.promise).toBe(operation.id);
    const row = z.object({ status: z.string(), result_json: z.string() }).parse(app.runtime.db.query(
      "SELECT status,result_json FROM operations WHERE id=?").get(operation.id));
    expect(row.status).toBe("succeeded");
    const result = z.object({ artifactId: IdSchema, regions: z.array(z.unknown()) }).parse(JSON.parse(row.result_json));
    expect(result.regions).toEqual([]);
    const artifact = await app.request(`/api/artifacts/${result.artifactId}/content`, { headers });
    expect(await pdfText(new Uint8Array(await artifact.arrayBuffer()))).toContain("Latent Dynamics");
    expect(z.object({ count: z.number() }).parse(app.runtime.db.query(
      "SELECT count(*) AS count FROM compiler_previews").get()).count).toBe(0);
  } finally { clearTimeout(deadline); unsubscribe(); }
}, 90000);

test("T08 HTTP cancellation uses real session CSRF and version checks", async () => {
  // Given a queued real core compile and its version ETag.
  await using app = await compilerHttp();
  const headers = await app.login();
  const created = await app.request(`/api/projects/${ids.project}/compiles`, { method: "POST",
    headers: { ...headers, "idempotency-key": "http-cancel" },
    body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, settings, clean: false }) });
  const job = z.object({ data: CompileJobSchema }).parse(await created.json()).data;
  const get = await app.request(`/api/compiles/${job.id}`, { headers });
  const version = parseResourceVersionTag(get.headers.get("etag"));
  // When the authenticated caller cancels the queued job with its actual version.
  const canceled = await app.request(`/api/compiles/${job.id}/cancel`, { method: "POST", headers,
    body: JSON.stringify({ expectedVersion: version }) });
  // Then cancellation is durable and the generated cache can be cleared without modifying source.
  expect(canceled.status, await canceled.clone().text()).toBe(200);
  expect((await app.runtime.services.get("compiler").get(ids.kien, job.id)).status).toBe("canceled");
  const cleared = await app.request(`/api/projects/${ids.project}/compile-cache`, { method: "DELETE", headers,
    body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" },
      expectedVersion: z.object({ version: z.number() }).parse(app.runtime.db.query("SELECT version FROM projects WHERE id=?").get(ids.project)).version }) });
  expect(cleared.status).toBe(200);
  expect((await app.request(`/api/compiles/${job.id}/cancel`, { method: "POST", headers: { cookie: headers.cookie },
    body: JSON.stringify({ expectedVersion: version }) })).status).toBe(403);
}, 60000);

for (const action of ["launch", "cancel", "cache"] as const) {
  test(`T08 HTTP denies viewer ${action} through the actual core role port`, async () => {
    // Given a queued owner job and a genuine viewer session with valid CSRF.
    await using app = await compilerHttp();
    const job = await app.runtime.services.get("compiler").enqueue(ids.kien,
      { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, settings, clean: false }, `viewer-${action}`);
    const headers = await app.login("alex@quire.local");
    const actions = {
      launch: { path: `/api/projects/${ids.project}/compiles`, method: "POST",
        body: { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0, settings, clean: false } },
      cancel: { path: `/api/compiles/${job.id}/cancel`, method: "POST", body: { expectedVersion: 1 } },
      cache: { path: `/api/projects/${ids.project}/compile-cache`, method: "DELETE",
        body: { scope: { projectId: ids.project, branch: "main" }, expectedVersion: 0 } },
    } as const;
    // When the viewer attempts the selected compile mutation.
    const operation = actions[action];
    const response = await app.request(operation.path, { method: operation.method,
      headers: { ...headers, "idempotency-key": `viewer-${action}` }, body: JSON.stringify(operation.body) });
    // Then authorization, rather than CSRF or input parsing, rejects it.
    expect(response.status).toBe(403);
    expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("FORBIDDEN");
  }, 90000);
}

test("T08 HTTP cache clear removes real generated cache without altering immutable source", async () => {
  // Given a successful real core compile with a populated generated cache.
  await using app = await compilerHttp();
  const headers = await app.login();
  const done = terminalEvent(app.runtime);
  await app.runtime.start();
  const job = await app.runtime.services.get("compiler").enqueue(ids.kien,
    { scope: { projectId: ids.project, branch: "main" }, expectedRevision: 0,
      settings: { ...settings, stopOnFirstError: false }, clean: true }, "cache-clear");
  await done;
  const count = () => z.object({ count: z.number() }).parse(app.runtime.db.query("SELECT count(*) AS count FROM compiler_cache").get()).count;
  expect(count()).toBe(1);
  const projects = app.runtime.services.get("projects");
  const before = await projects.readSnapshot(job.snapshot.id);
  const version = z.object({ version: z.number() }).parse(app.runtime.db.query("SELECT version FROM projects WHERE id=?").get(ids.project)).version;
  // When the authorized HTTP cache mutation runs.
  const response = await app.request(`/api/projects/${ids.project}/compile-cache`, { method: "DELETE", headers,
    body: JSON.stringify({ scope: job.snapshot.scope, expectedVersion: version }) });
  // Then actual generated cache is gone while the source blob identities remain unchanged.
  expect(response.status).toBe(200);
  expect(count()).toBe(0);
  expect((await projects.readSnapshot(job.snapshot.id)).files.map((file) => file.blob)).toEqual(before.files.map((file) => file.blob));
}, 90000);
