import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { CompilerLeases, CompilerService } from "../../services/compiler";
import { compilerHttp } from "./http-fixture";
import { fixtureIds as ids, settings } from "./fixtures";

test("invalidates legacy diagnostic caches while retaining current local and remote cache hits", async () => {
  await using app = await compilerHttp();
  const service = app.runtime.services.get("compiler");
  if (!(service instanceof CompilerService)) throw new TypeError("Actual compiler required");
  const scope = { projectId: ids.project, branch: "main" };
  const request = { scope, expectedRevision: 0, settings, clean: false };
  const builds = spyOn(service.environments, "build");
  try {
    // Given: an actual successful PDF cache persisted with the old, unversioned diagnostic format.
    const first = await service.enqueue(ids.kien, { ...request, clean: true }, "diagnostics-first");
    await service.execute(first.id, AbortSignal.timeout(30000));
    expect((await service.store.get(first.id)).status).toBe("succeeded");
    const source = await app.runtime.services.get("projects").readSnapshot(first.snapshot.id);
    const environment = await service.resolveEnvironment(first.environmentId);
    const legacyKey = new Bun.CryptoHasher("sha256").update(JSON.stringify({
      scope: first.snapshot.scope, files: source.files.map(file => [file.id, file.path, file.blob]),
      settings, environment: environment.rootOrImageDigest,
    })).digest("hex");
    await app.runtime.db.run("UPDATE compiler_cache SET cache_key=? WHERE job_id=?", [legacyKey, first.id]);
    await app.runtime.db.run(`INSERT INTO diagnostics(id,job_id,severity,message,file_id,line,"column",raw_start,raw_end)
      VALUES(?,?,'warning','stale cached warning',?,NULL,NULL,0,1)`, [crypto.randomUUID(), first.id, ids.mainFile]);
    expect(builds).toHaveBeenCalledTimes(1);
    const oldQueued = await service.enqueue(ids.kien, request, "diagnostics-legacy-queued");
    await app.runtime.db.run("UPDATE compiler_requests SET cache_key=? WHERE job_id=?", [legacyKey, oldQueued.id]);
    expect((await new CompilerLeases(service).lease(ids.operator, [ids.environment]))?.jobId).toBe(oldQueued.id);
    expect((await service.store.get(oldQueued.id)).status).toBe("running");
    await service.cancel(ids.kien, oldQueued.id);

    // When: the local worker sees the same immutable source under the new diagnostic format.
    const current = await service.enqueue(ids.kien, request, "diagnostics-current");
    await service.execute(current.id, AbortSignal.timeout(30000));
    const currentJob = await service.store.get(current.id);
    expect(currentJob.status).toBe("succeeded");
    expect(builds).toHaveBeenCalledTimes(2);
    expect(currentJob.diagnostics.some(item => item.message === "stale cached warning")).toBe(false);
    const currentKey = z.object({ cache_key: z.string() }).parse(await app.runtime.db.get(
      "SELECT cache_key FROM compiler_cache WHERE job_id=?", [current.id])).cache_key;
    expect(currentKey).not.toBe(legacyKey);

    // Then: both queue paths still reuse the current cache, never the old warning record.
    const local = await service.enqueue(ids.kien, request, "diagnostics-local-hit");
    await service.execute(local.id, AbortSignal.timeout(30000));
    expect((await service.store.get(local.id)).status).toBe("succeeded");
    const remote = await service.enqueue(ids.kien, request, "diagnostics-remote-hit");
    expect(await new CompilerLeases(service).lease(ids.operator, [ids.environment])).toBeNull();
    const reused = await service.store.get(remote.id);
    expect(reused.status).toBe("succeeded");
    expect(reused.diagnostics.some(item => item.message === "stale cached warning")).toBe(false);
    expect(reused.artifacts.some(item => item.kind === "pdf")).toBe(true);
    expect(builds).toHaveBeenCalledTimes(2);
  } finally { builds.mockRestore(); }
}, 90000);
