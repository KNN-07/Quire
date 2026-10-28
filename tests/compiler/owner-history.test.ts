import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { IdSchema, InstantSchema, OperationSchema, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { CompilerService, CompilerLeases } from "../../services/compiler";
import { compilerHttp } from "./http-fixture";
import { fixtureIds as ids, settings } from "./fixtures";

const clock = { now: () => InstantSchema.parse("2026-10-27T12:00:00.000Z") };
async function comparison(app: Awaited<ReturnType<typeof compilerHttp>>, headers: Record<string, string>,
  snapshots: readonly [Id, Id]) {
  const finished = Promise.withResolvers<void>();
  const deadline = setTimeout(() => finished.reject(new TypeError("Historical comparison did not complete")), 90000);
  const unsubscribe = app.runtime.events.subscribe(event => {
    if (event.topic === "operation.changed" && event.aggregateId === ids.project &&
      event.payload.status !== "running") finished.resolve();
  });
  try {
    const response = await app.request(`/api/projects/${ids.project}/pdf-diffs`, { method: "POST",
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ fromSnapshotId: snapshots[0], toSnapshotId: snapshots[1], mode: "overlay" }) });
    expect(response.status).toBe(202);
    const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
    await finished.promise;
    return z.object({ status: z.string(), result_json: z.string().nullable(), error_code: z.string().nullable() }).parse(
      await app.runtime.db.get("SELECT status,result_json,error_code FROM operations WHERE id=?", [operation.id]));
  } finally { clearTimeout(deadline); unsubscribe(); }
}
async function captured(app: Awaited<ReturnType<typeof compilerHttp>>, input: {
  readonly snapshotId: Id; readonly labeled: boolean;
}) {
  await app.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'",
      [JSON.stringify({ compileSeconds: 12, writableMembers: null, historyDays: 1, trackChanges: false })]);
    const id = IdSchema.parse(crypto.randomUUID());
    await tx.run(`INSERT INTO history_versions(id,snapshot_id,review_snapshot_id,review_json,authors_json,created_at)
      VALUES(?,?,?,'{}','[]','2026-10-25T12:00:00.000Z')`, [id, input.snapshotId, crypto.randomUUID()]);
    if (input.labeled) await tx.run(
      "INSERT INTO version_labels(id,history_version_id,name,author_id,created_at) VALUES(?,?,'Retained',?,?)",
      [crypto.randomUUID(), id, ids.kien, clock.now()]);
  });
}
test("rejects PDF diff against expired captured history without requiring review registration", async () => {
  // Given: a fresh snapshot whose captured history timestamp, not snapshot timestamp, is expired.
  await using app = await compilerHttp({ clock });
  await captured(app, { snapshotId: ids.snapshot, labeled: false });
  const owner = await app.login();
  // When: actual historical PDF comparison is requested.
  const response = await app.request(`/api/projects/${ids.project}/pdf-diffs`, { method: "POST",
    headers: { ...owner, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ fromSnapshotId: ids.snapshot, toSnapshotId: ids.snapshot, mode: "overlay" }) });
  // Then: no operation or compile is admitted from inaccessible history.
  expect(response.status).toBe(403);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("HISTORY_WINDOW");
  expect(await app.runtime.db.all("SELECT id FROM compile_jobs")).toHaveLength(0);
  expect(await app.runtime.db.all("SELECT id FROM operations WHERE kind='pdf-diff'")).toHaveLength(0);
}, 120000);
test("uses current budgets and snapshot-linked labels for actual PDF diff artifact reads", async () => {
  // Given: old captured history whose label ID differs from its snapshot ID.
  await using app = await compilerHttp({ clock });
  await captured(app, { snapshotId: ids.snapshot, labeled: true });
  const owner = await app.login();
    // When: the real historical comparison compiles both snapshots and renders its PDF.
    const result = await comparison(app, owner, [ids.snapshot, ids.snapshot]);
    // Then: both historical jobs use the current budget and their labeled artifact is accessible.
    expect(result.status).toBe("succeeded");
    expect(result.error_code).toBeNull();
    const requests = z.array(z.object({ limits_json: z.string() })).parse(await app.runtime.db.all("SELECT limits_json FROM compiler_requests"));
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(z.object({ wallSeconds: z.number() }).parse(JSON.parse(request.limits_json)).wallSeconds).toBe(12);
    const artifact = z.object({ artifactId: IdSchema }).parse(JSON.parse(z.string().parse(result.result_json)));
    const bytes = await app.request(endpoints.artifactContent.path.replace(":id", artifact.artifactId), { headers: owner });
    expect(bytes.status).toBe(200);
    expect(new TextDecoder().decode(new Uint8Array(await bytes.arrayBuffer()).subarray(0, 5))).toBe("%PDF-");
}, 120000);
for (const labeled of [false, true]) {
  test(`rechecks both historical PDF-diff sources at byte access when the old source is labeled=${labeled}`, async () => {
    // Given: a genuine comparison with an old left source and a fresh right source.
    let now = InstantSchema.parse("2026-10-25T12:00:00.000Z");
    await using app = await compilerHttp({ clock: { now: () => now } });
    const owner = await app.login();
    now = InstantSchema.parse("2026-10-27T12:00:00.000Z");
    const fresh = await app.runtime.services.get("projects").snapshot(ids.kien, { projectId: ids.project, branch: "main" }, 0);
    const result = await comparison(app, owner, [ids.snapshot, fresh.id]);
    expect(result.status).toBe("succeeded");
    const artifact = z.object({ artifactId: IdSchema }).parse(JSON.parse(z.string().parse(result.result_json)));
    await captured(app, { snapshotId: ids.snapshot, labeled });
    // When: comparison bytes are fetched after the old source's history entitlement changes.
    const response = await app.request(endpoints.artifactContent.path.replace(":id", artifact.artifactId), { headers: owner });
    // Then: a fresh right-hand job cannot authorize inaccessible left-hand history.
    expect(response.status).toBe(labeled ? 200 : 403);
    if (!labeled) expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("HISTORY_WINDOW");
  }, 120000);
}
for (const mode of ["local", "remote"] as const) {
  test(`rechecks captured history before a queued ${mode} claim without incrementing attempts`, async () => {
    // Given: a queue admission followed by an expired captured-history boundary.
    await using app = await compilerHttp({ clock });
    const compiler = app.runtime.services.get("compiler");
    if (!(compiler instanceof CompilerService)) throw new TypeError("Actual compiler required");
    const job = await compiler.enqueue(ids.kien, { scope: { projectId: ids.project, branch: "main" },
      expectedRevision: 0, settings, clean: false }, "historical-claim");
    await captured(app, { snapshotId: job.snapshot.id, labeled: false });
    // When: the actual claim executes under current account/compile locks.
    if (mode === "local") await compiler.execute(job.id, AbortSignal.timeout(30000));
    else expect(await new CompilerLeases(compiler).lease(ids.operator, [ids.environment])).toBeNull();
    // Then: no attempt, cache success, or build can consume inaccessible history.
    expect(await compiler.store.get(job.id)).toMatchObject({ status: "canceled", failureCode: "POLICY_CHANGED", startedAt: null });
    expect((await compiler.store.raw(job.id)).attempt).toBe(0);
  }, 120000);
}
test("rechecks history after actual artifact bytes are prepared outside the account transaction", async () => {
  // Given: a genuine old compile artifact admitted under unlimited history.
  let now = InstantSchema.parse("2026-10-25T12:00:00.000Z");
  await using app = await compilerHttp({ clock: { now: () => now } });
  const compiler = app.runtime.services.get("compiler");
  if (!(compiler instanceof CompilerService)) throw new TypeError("Actual compiler required");
  const job = await compiler.enqueue(ids.kien, { scope: { projectId: ids.project, branch: "main" },
    expectedRevision: 0, settings, clean: true }, "artifact-publication-fence");
  await compiler.execute(job.id, AbortSignal.timeout(30000));
  const artifact = (await compiler.store.get(job.id)).artifacts.find(item => item.name === "output.pdf");
  if (!artifact) throw new TypeError("Genuine PDF artifact required");
  now = InstantSchema.parse("2026-10-27T12:00:00.000Z");
  const owner = await app.login();
  const get = app.runtime.blobs.get.bind(app.runtime.blobs);
  const barrier = spyOn(app.runtime.blobs, "get").mockImplementationOnce(async digest => {
    const bytes = await get(digest);
    await app.runtime.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.run("UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'",
        [JSON.stringify({ compileSeconds: 12, writableMembers: null, historyDays: 1, trackChanges: false })]);
    });
    return bytes;
  });
  try {
    // When: artifact preparation resumes after a committed history downgrade.
    const response = await app.request(endpoints.artifactContent.path.replace(":id", artifact.id), { headers: owner });
    // Then: the publication fence denies bytes rather than trusting the earlier read admission.
    expect(response.status).toBe(403);
    expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("HISTORY_WINDOW");
  } finally { barrier.mockRestore(); }
}, 120000);
