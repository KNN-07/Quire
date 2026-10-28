import { test } from "bun:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CompileJobSchema, FileEntrySchema, HistoryVersionSchema, ProjectSchema, ScopeSchema, ThreadSchema } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import { transferQuiesced } from "../../../apps/server/src/transfer";
import { CoreProjects, readZip } from "../../../services/core/base";
import { seed } from "../../../scripts/seed";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { topology, responseData } from "./topology";
import { bounded } from "./process";
import { eventStream } from "./events";

const password = "p1s-real-integration-password";
const origin = "http://localhost:5173";
function request(url: string, path: string, headers: HeadersInit = {}, body?: unknown, method = "POST") {
  return fetch(new URL(path, url), {
    method: body === undefined ? "GET" : method,
    headers: { ...Object.fromEntries(new Headers(headers)), origin,
      ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120000),
  });
}
async function login(url: string) {
  const response = await request(url, "/api/auth/login", {}, { email: "kien@quire.local", password });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const me = await responseData(await request(url, "/api/me", { cookie }),
    z.object({ csrfToken: z.string() }));
  return { cookie, "x-csrf-token": me.csrfToken };
}

test("real two-API scale assembly transfers native state and survives coordination and worker failures", async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), "quire-p1s-integrate-native-"));
  let source: Awaited<ReturnType<typeof createApplication>> | undefined;
  let nativeServer: ReturnType<typeof Bun.serve> | undefined;
  try {
    const nativeConfig = loadConfig({ QUIRE_DATA_DIR: sourceDir, QUIRE_PUBLIC_URL: origin });
    source = await createApplication({ config: nativeConfig });
    await seed(source.runtime, password);
    nativeServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: source.fetch });
    const originalSession = await login(nativeServer.url.toString());
    const core = new CoreProjects({ ...source.runtime, routes: source.runtime.routes.forLane("K") });
    const scope = ScopeSchema.parse({ projectId: ids.project, branch: "main" });
    const snapshot = await core.snapshot(ids.kien, scope, 0);
    const sourceBlob = (await core.getFile(scope, ids.mainFile)).blob;
    assert.ok(sourceBlob);
    const sourceBytes = await source.runtime.blobs.get(sourceBlob);
    const originalHead = await source.runtime.db.get("SELECT head FROM branch_heads WHERE project_id=?", [ids.project]);
    const nativeHeaders = { ...originalSession, origin, "content-type": "application/json",
      "idempotency-key": crypto.randomUUID() };
    const nativeBody = JSON.stringify({ scope, path: "native-receipt.tex", kind: "file", text: "NATIVE_RECEIPT", expectedVersion: 0 });
    const nativeCreated = await responseData(await fetch(new URL(`/api/projects/${ids.project}/files`, nativeServer.url),
      { method: "POST", headers: nativeHeaders, body: nativeBody }), FileEntrySchema);
    const thread = await responseData(await request(nativeServer.url.toString(), `/api/projects/${ids.project}/threads`,
      originalSession, { scope, body: "Deleted before transfer", expectedVersion: 1 }), ThreadSchema);
    const comment = thread.comments[0];
    assert.ok(comment);
    const deleted = await request(nativeServer.url.toString(), `/api/projects/${ids.project}/comments/${comment.id}`,
      originalSession, { expectedVersion: 0 }, "DELETE");
    assert.equal(deleted.status, 200, await deleted.clone().text());
    const tombstone = await source.runtime.db.get("SELECT * FROM permanent_comment_tombstones WHERE comment_id=?", [comment.id]);
    assert.ok(tombstone);
    const nativeReceipts = await source.runtime.db.all("SELECT * FROM idempotency_results ORDER BY actor_id,key,route");
    assert.ok(nativeReceipts.length);
    const key = Buffer.from(source.runtime.secretKey).toString("hex");
    nativeServer[Symbol.dispose](); nativeServer.unref(); nativeServer = undefined;
    await source.close(); source = undefined;
    await using cluster = await topology(key);
    const native = await createRuntime(nativeConfig, { foundation: cluster.foundation });
    const controller = await cluster.createController();
    try {
      await assert.rejects(transferQuiesced(native, controller, false), { code: "TRANSFER_QUIESCENCE_REQUIRED" });
      const receipt = await transferQuiesced(native, controller, true);
      assert.equal(receipt.blobs > 0, true);
      assert.equal(receipt.repositories, 1);
      console.info("TRANSFER_RECEIPT", JSON.stringify(receipt));
    } finally { await native.close(); await controller.close(); }
    const a = await cluster.api("api-a");
    const b = await cluster.api("api-b");
    assert.notEqual(a.api.child.pid, b.api.child.pid);
    assert.equal((await request(b.url, "/api/me", originalSession)).status, 200);
    assert.deepEqual(await cluster.storage.db.get("SELECT * FROM permanent_comment_tombstones WHERE comment_id=?", [comment.id]), tombstone);
    assert.deepEqual(await cluster.storage.db.all("SELECT * FROM idempotency_results ORDER BY actor_id,key,route"), nativeReceipts);
    const migratedReplay = await responseData(await fetch(new URL(`/api/projects/${ids.project}/files`, b.url),
      { method: "POST", headers: nativeHeaders, body: nativeBody }), FileEntrySchema);
    assert.equal(migratedReplay.id, nativeCreated.id);
    await rm(join(cluster.root, "api-b", "blobs"), { recursive: true, force: true });
    await rm(join(cluster.root, "api-b", "git"), { recursive: true, force: true });
    const health = await responseData(await request(b.url, "/api/health"),
      z.object({ database: z.literal("postgres") }));
    assert.equal(health.database, "postgres");
    assert.deepEqual(await cluster.storage.db.get("SELECT head FROM branch_heads WHERE project_id=?", [ids.project]), originalHead);
    const bytes = new Uint8Array(await (await request(b.url,
      `/api/projects/${ids.project}/files/${ids.mainFile}/content?branch=main`, originalSession)).arrayBuffer());
    assert.deepEqual(bytes, sourceBytes);
    const history = await responseData(await request(b.url,
      `/api/projects/${ids.project}/history?branch=main`, originalSession),
      z.object({ items: z.array(HistoryVersionSchema) }));
    const version = history.items.find(item => item.snapshot.id === snapshot.id);
    assert.ok(version);
    const archive = await request(b.url, `/api/projects/${ids.project}/history/${version.id}/source.zip?branch=main`, originalSession);
    assert.equal(archive.status, 200, await archive.clone().text());
    assert.deepEqual(readZip(new Uint8Array(await archive.arrayBuffer())).find(file => file.path === "main.tex")?.bytes, sourceBytes);
    console.info("SCALE_S3_HISTORY_BYTES", { bytes: sourceBytes.length, sha256: sourceBlob, snapshotId: snapshot.id });

    // The migrated cookie and its CSRF token must authorize a mutation on the other OS process.
    const create = async (url: string, headers: HeadersInit, path: string) => {
      const listed = await request(url, `/api/projects/${ids.project}/files?branch=main`, headers);
      const revision = Number(listed.headers.get("etag")?.match(/^"v(\d+)"$/)?.[1]);
      return responseData(await request(url, `/api/projects/${ids.project}/files`, headers,
        { scope, path, kind: "file", text: path, expectedVersion: revision }), FileEntrySchema);
    };
    await create(b.url, originalSession, "migrated-session.tex");
    const retainedSession = await login(b.url);
    await using revoked = await eventStream(a.url, originalSession);
    const revocation = bounded(revoked.closed);
    assert.equal((await request(b.url, "/api/me/sessions/revoke-others", retainedSession, {})).status, 200);
    await revocation;
    assert.equal((await request(a.url, "/api/me", originalSession)).status, 401);
    assert.equal((await request(a.url, "/api/me", retainedSession)).status, 200);
    console.info("CROSS_INSTANCE_REVOCATION_PASSED");

    await using stream = await eventStream(b.url, retainedSession);
    await cluster.redisStop();
    const offline = stream.next(event => event.topic === "tree.changed" && event.aggregateId === ids.project);
    const outageFile = await create(a.url, retainedSession, "redis-outage.tex");
    const caught = await offline;
    assert.ok(caught.seq > 0);
    await cluster.redisStart();
    const afterReconnect = stream.next(event => event.topic === "tree.changed" && event.seq > caught.seq);
    await create(a.url, retainedSession, "redis-restored.tex");
    await afterReconnect;
    assert.equal(stream.events.filter(event => event.seq === caught.seq).length, 1);
    console.info("REDIS_OUTAGE_CATCHUP_PASSED", { seq: caught.seq, file: outageFile.id });

    // Stop the actual API after its lease, expire only authoritative SQL time, then resume it.
    const stale = await a.api.call("acquire", scope);
    assert.ok(stale);
    assert.equal(a.api.child.kill("SIGSTOP"), true);
    let successor: unknown;
    try {
      await cluster.storage.db.run("UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=?",
        ["2000-01-01T00:00:00.000Z", ids.project, "main"]);
      successor = await b.api.call("acquire", scope);
      assert.ok(successor);
    } finally { a.api.child.kill("SIGCONT"); }
    await assert.rejects(a.api.call("staleWrite", { lease: stale, actorId: ids.kien }), /STALE_BRANCH_FENCE/);
    await b.api.call("release", successor);
    console.info("PAUSED_STALE_WRITER_FENCED");

    const listed = await request(a.url, `/api/projects/${ids.project}/files?branch=main`, retainedSession);
    const revision = Number(listed.headers.get("etag")?.match(/^"v(\d+)"$/)?.[1]);
    await a.api.call("armCrash");
    const published = a.api.signal("published");
    const mutationHeaders = { ...retainedSession, origin, "content-type": "application/json",
      "idempotency-key": crypto.randomUUID() };
    const body = JSON.stringify({ scope, path: "crash-recovered.tex", kind: "file", text: "CRASH_RECOVERED", expectedVersion: revision });
    const interrupted = fetch(new URL(`/api/projects/${ids.project}/files`, a.url), {
      method: "POST", headers: mutationHeaders, body,
    }).then(() => undefined, () => undefined);
    await published;
    const deadLeases = await cluster.storage.db.all<{
      project_id: string; branch: string; owner: string; fence: number;
    }>("SELECT project_id,branch,owner,fence FROM branch_leases WHERE expires_at>?", [new Date().toISOString()]);
    assert.deepEqual(deadLeases.map(lease => lease.branch).sort(), ["http-receipt", "main"]);
    a.api.child.kill("SIGKILL");
    await bounded(a.api.exited);
    await interrupted;
    // Expire both the dead source lease and its distinct durable HTTP-receipt lease.
    await cluster.storage.uow.run(async tx => {
      for (const lease of deadLeases) await tx.run(
        "UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=? AND owner=? AND fence=?",
        ["2000-01-01T00:00:00.000Z", lease.project_id, lease.branch, lease.owner, lease.fence]);
    });
    const c = await cluster.api("api-c-recovery");
    assert.equal(await cluster.storage.db.get("SELECT id FROM base_source_intents"), null);
    assert.equal(await cluster.storage.db.get("SELECT id FROM repository_intents WHERE state<>'finalized'"), null);
    assert.ok(await cluster.storage.db.get("SELECT key FROM idempotency_results WHERE actor_id=? AND key=?",
      [ids.kien, mutationHeaders["idempotency-key"]]));
    const replay = await responseData(await fetch(new URL(`/api/projects/${ids.project}/files`, c.url),
      { method: "POST", headers: mutationHeaders, body }), FileEntrySchema);
    assert.equal(replay.path, "crash-recovered.tex");
    assert.equal(await (await request(b.url, `/api/projects/${ids.project}/files/${replay.id}/content?branch=main`, retainedSession)).text(), "CRASH_RECOVERED");
    assert.equal(await cluster.storage.db.get("SELECT id FROM base_source_intents"), null);
    assert.equal(await cluster.storage.db.get("SELECT id FROM repository_intents WHERE state<>'finalized'"), null);
    const sourceEvents = await cluster.storage.db.all<{ payload_json: string }>(
      "SELECT payload_json FROM events WHERE topic='tree.changed' AND aggregate_id=?", [ids.project]);
    assert.equal(sourceEvents.filter(event =>
      z.object({ version: z.number() }).parse(JSON.parse(event.payload_json)).version === revision + 1).length, 1);
    console.info("CRASH_POINT_RECOVERY_PASSED", { file: replay.id });

    const project = await responseData(await request(c.url, "/api/projects", retainedSession,
      { name: "Scale remote worker replacement", origin: { kind: "example" } }), ProjectSchema);
    const compileScope = { projectId: project.id, branch: project.defaultBranch };
    const compileFiles = await request(c.url, `/api/projects/${project.id}/files?branch=${project.defaultBranch}`, retainedSession);
    const compileRevision = Number(compileFiles.headers.get("etag")?.match(/^"v(\d+)"$/)?.[1]);
    assert.equal(Number.isInteger(compileRevision), true);
    const compile = () => request(c.url, `/api/projects/${project.id}/compiles`, retainedSession,
      { scope: compileScope, expectedRevision: compileRevision, clean: true });
    await c.api.call("armWorkerSource");
    const sourceRequested = c.api.signal("worker-source-requested");
    const running = stream.next(event => event.topic === "job.changed" && event.aggregateId === project.id && event.payload.status === "running");
    const abandoned = await responseData(await compile(), CompileJobSchema);
    const firstWorkerId = crypto.randomUUID();
    const firstWorker = cluster.worker(c.url, firstWorkerId);
    await Promise.all([running, sourceRequested]);
    const claimed = await responseData(await request(c.url, `/api/compiles/${abandoned.id}`, retainedSession), CompileJobSchema);
    assert.equal(claimed.workerId, firstWorkerId);
    await firstWorker.stop();
    await c.api.call("releaseWorkerSource");
    const failed = stream.next(event => event.topic === "job.changed" && event.payload.resourceId === abandoned.id && event.payload.status === "failed");
    await cluster.storage.db.run("UPDATE worker_leases SET expires_at=? WHERE job_id=?",
      ["2000-01-01T00:00:00.000Z", abandoned.id]);
    // A real internal lease request runs the normal reaper, without guessing its timer.
    await responseData(await request(c.url, "/internal/workers/lease", { authorization: `Bearer ${cluster.workerBearer}` },
      { workerId: crypto.randomUUID(), environmentIds: [] }), z.object({ lease: z.null() }));
    await failed;
    const expired = await responseData(await request(c.url, `/api/compiles/${abandoned.id}`, retainedSession), CompileJobSchema);
    assert.equal(expired.failureCode, "WORKER_LEASE_EXPIRED");
    const done = stream.next(event => event.topic === "job.changed" && event.aggregateId === project.id && event.payload.status === "succeeded");
    const queued = await responseData(await compile(), CompileJobSchema);
    const replacementId = crypto.randomUUID();
    const replacement = cluster.worker(b.url, replacementId);
    await done;
    await replacement.stop();
    const job = await responseData(await request(c.url, `/api/compiles/${queued.id}`, retainedSession), CompileJobSchema);
    assert.equal(job.status, "succeeded", job.failureCode ?? "");
    assert.equal(job.workerId, replacementId);
    assert.equal(job.diagnostics.filter(item => item.severity === "error").length, 0);
    const pdf = job.artifacts.find(item => item.kind === "pdf");
    assert.ok(pdf);
    const actualPdf = new Uint8Array(await (await request(c.url, `/api/artifacts/${pdf.id}/content`, retainedSession)).arrayBuffer());
    assert.equal(new TextDecoder().decode(actualPdf.slice(0, 5)), "%PDF-");
    assert.equal(new Bun.CryptoHasher("sha256").update(actualPdf).digest("hex"), pdf.sha256);
    const evidence = new URL(`../../../docs/evidence/p1s-integrate/scale-output-${job.id}.pdf`, import.meta.url);
    await mkdir(new URL(".", evidence), { recursive: true });
    await writeFile(evidence, actualPdf);
    console.info("REMOTE_COMPILER_REPLACEMENT_PASSED", { job: job.id, bytes: actualPdf.length,
      sha256: pdf.sha256, evidence: evidence.pathname });
  } finally {
    if (nativeServer) { nativeServer[Symbol.dispose](); nativeServer.unref(); }
    if (source) await source.close();
    await rm(sourceDir, { recursive: true, force: true });
    console.info("NATIVE_TRANSFER_SOURCE_CLEANED", sourceDir);
  }
}, 600000);
