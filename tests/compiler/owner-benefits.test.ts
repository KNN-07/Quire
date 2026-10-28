import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import type { ProjectBenefits } from "@quire/contracts";
import { EnvironmentSchema, InstantSchema } from "@quire/contracts";
import { CompilerService, CompilerLeases, configureCompilerEnvironments } from "../../services/compiler";
import { build } from "../../workers/compiler/build";
import { compilerHttp } from "./http-fixture";
import { fixtureIds as ids, settings } from "./fixtures";
import { bounded } from "../core/review/harness";

const scope = { projectId: ids.project, branch: "main" };
const basic = { compileSeconds: 12, writableMembers: 2, historyDays: 1, trackChanges: false } as const;
const clock = { now: () => InstantSchema.parse("2026-10-27T12:00:00.000Z") };
async function baseline(service: CompilerService, benefits: ProjectBenefits) {
  await service.context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("UPDATE account_project_benefits SET benefits_json=?,version=version+1 WHERE scope_kind='deployment'",
      [JSON.stringify(benefits)]);
  });
}
test("persists the current wall budget after immutable preparation rather than an earlier policy read", async () => {
  // Given: a real compiler and a downgrade at its post-snapshot read seam.
  await using app = await compilerHttp({ clock });
  const service = app.runtime.services.get("compiler");
  if (!(service instanceof CompilerService)) throw new TypeError("Actual compiler required");
  const projects = app.runtime.services.get("projects");
  const read = projects.readSnapshot.bind(projects);
  const barrier = spyOn(projects, "readSnapshot").mockImplementationOnce(async id => {
    const source = await read(id);
    await baseline(service, basic);
    return source;
  });
  try {
    // When: admission resumes after the downgrade committed.
    const job = await service.enqueue(ids.kien, { scope, expectedRevision: 0, settings, clean: true }, "fresh-benefit-admission");
    // Then: the persisted execution budget reflects the transaction's current policy.
    expect((await service.limits(job.id)).wallSeconds).toBe(12);
    expect((await service.store.get(job.id)).status).toBe("queued");
  } finally { barrier.mockRestore(); }
}, 120000);

for (const mode of ["local", "remote"] as const) {
  for (const change of ["unselect", "transfer"] as const) {
    test(`cancels queued ${mode} cache reuse after ${change} without a new attempt`, async () => {
      // Given: a genuine successful compile cache and a second queued compile by its Editor.
      await using app = await compilerHttp({ clock });
      const service = app.runtime.services.get("compiler");
      if (!(service instanceof CompilerService)) throw new TypeError("Actual compiler required");
      await baseline(service, basic);
      const builds = spyOn(service.environments, "build");
      try {
        const cached = await service.enqueue(ids.mai, { scope, expectedRevision: 0, settings, clean: true }, "benefit-cache-source");
        await service.execute(cached.id, AbortSignal.timeout(30000));
        expect((await service.store.get(cached.id)).status).toBe("succeeded");
        const queued = await service.enqueue(ids.mai, { scope, expectedRevision: 0, settings, clean: false }, "benefit-queued");
        const owner = await app.login();
        const version = z.object({ version: z.number() }).parse(await app.runtime.db.get("SELECT version FROM projects WHERE id=?", [ids.project])).version;
        const changed = change === "transfer"
          ? await app.request(`/api/projects/${ids.project}/transfer`, { method: "POST",
            headers: { ...owner, "idempotency-key": crypto.randomUUID() },
            body: JSON.stringify({ newOwnerId: ids.sam, expectedVersion: version }) })
          : await app.request(`/api/projects/${ids.project}/writable-members`, { method: "PUT", headers: owner,
            body: JSON.stringify({ memberIds: [], expectedVersion: version }) });
        expect(changed.status).toBe(200);
        // When: the current queue claim encounters the now-ineligible actor before its valid cache.
        if (mode === "local") await service.execute(queued.id, AbortSignal.timeout(30000));
        else expect(await new CompilerLeases(service).lease(ids.operator, [ids.environment])).toBeNull();
        // Then: cancellation precedes both cache success and attempt/provider work.
        expect(await service.store.get(queued.id)).toMatchObject({ status: "canceled", failureCode: "POLICY_CHANGED",
          startedAt: null, artifacts: [] });
        expect((await service.store.raw(queued.id)).attempt).toBe(0);
        expect(builds).toHaveBeenCalledTimes(1);
      } finally { builds.mockRestore(); }
    }, 120000);
  }
}

test("retains a running execution's bounded start-time budget after downgrade", async () => {
  // Given: an actual build held after its running lease and budget are established.
  await using app = await compilerHttp({ clock });
  const service = app.runtime.services.get("compiler");
  if (!(service instanceof CompilerService)) throw new TypeError("Actual compiler required");
  await baseline(service, { ...basic, compileSeconds: 90 });
  const row = z.object({ manifest_json: z.string() }).parse(await app.runtime.db.get(
    "SELECT manifest_json FROM environments WHERE id=?", [ids.environment]));
  const entered = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  configureCompilerEnvironments(app.runtime, {
    resolve: async () => EnvironmentSchema.parse(JSON.parse(row.manifest_json)),
    build: async input => {
      entered.resolve(input.limits?.wallSeconds ?? 0);
      await bounded(release.promise);
      return build(input);
    },
  });
  const job = await service.enqueue(ids.kien, { scope, expectedRevision: 0, settings, clean: true }, "running-budget");
  const running = service.execute(job.id, AbortSignal.timeout(30000));
  try {
    expect(await bounded(entered.promise)).toBe(90);
    // When: a current downgrade commits while the already-running build is held.
    await baseline(service, basic);
    release.resolve();
    await running;
    // Then: execution remains bounded by its original budget; subsequent policy is lower.
    expect((await service.store.get(job.id)).status).toBe("succeeded");
    expect((await service.limits(job.id)).wallSeconds).toBe(90);
    expect((await app.runtime.services.get("policy").forProject(ids.kien, ids.project)).compileSeconds).toBe(12);
  } finally { release.resolve(); await running; }
}, 120000);
