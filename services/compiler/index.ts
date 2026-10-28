import { z } from "zod";
import { endpoints, EnvironmentSchema, resourceVersionTag, IdSchema, assertNever } from "@quire/contracts";
import type { Id, Artifact } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { CompilerService } from "./service";
import type { CompilerEnvironments } from "./service";
import { probeEnvironment } from "./environment";
import { syncTex } from "./navigation";
import { pdfDifference } from "./diff";
import { registerWorkerRoutes } from "./worker-routes";
import { branchPreview } from "./preview";
import { quiesceCompilerJobs } from "./quiescence";
import { AccessStore } from "../core/base/access";
import { assertHistoryAccess } from "../core/base/history-access";
export { migrations } from "./store";
export { CompilerService } from "./service";
export type { CompilerEnvironments } from "./service";
export { CompilerLeases } from "./leases";
export { nativeEnvironmentId, probeEnvironment } from "./environment";
export { defaultLimits } from "../../workers/compiler/sandbox";
export { runRemoteWorker } from "../../workers/compiler/remote";
export { workerMain } from "../../workers/compiler/main";

const instances = new WeakMap<object, CompilerService>();
let nativeProbe: ReturnType<typeof probeEnvironment> | null = null;
export function configureCompilerEnvironments(
  context: Pick<ModuleContext, "services">, provider: CompilerEnvironments,
): void {
  const service = instances.get(context.services);
  if (!service) throw new ServiceError("COMPILER_NOT_REGISTERED", 503, "Register compiler before configuring environments");
  service.configureEnvironments(provider);
}
/** Caller holds runtime.admission.exclusive; local builds have already drained. */
export async function quiesceCompiler(context: Pick<ModuleContext, "services">): Promise<void> {
  const service = instances.get(context.services);
  if (!service) throw new ServiceError("COMPILER_NOT_REGISTERED", 503, "Register compiler before quiescing it");
  await quiesceCompilerJobs(service);
}
export async function startWorker(context: Pick<ModuleContext, "services">): Promise<void> {
  const service = instances.get(context.services);
  if (!service) throw new ServiceError("COMPILER_NOT_REGISTERED", 503, "Register compiler before starting worker");
  await service.start();
}
export async function stopWorker(context: Pick<ModuleContext, "services">): Promise<void> {
  await instances.get(context.services)?.stop();
}
export async function register(context: ModuleContext): Promise<void> {
  if (context.config.compilerBackend === "bwrap") nativeProbe ??= probeEnvironment();
  const environment = context.config.compilerBackend === "bwrap" ? await nativeProbe : null;
  if (environment) await context.db.run(`INSERT INTO environments(id,label,release,backend,manifest_json,available,probe_at,created_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,release=excluded.release,
    manifest_json=excluded.manifest_json,available=excluded.available,probe_at=excluded.probe_at`, [environment.id, environment.label, environment.release, environment.backend, JSON.stringify(environment), Number(environment.available), environment.probeAt, context.clock.now()]);
  const service = new CompilerService(context, environment);
  context.services.provide("compiler", service);
  instances.set(context.services, service);
  const actor = async (request: Request): Promise<Id> => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request);
    if (!["GET", "HEAD"].includes(request.method)) await identity.verifyMutation(request, principal);
    return principal.user.id;
  };
  const readJob = async (request: Request, id: Id, comparisonJobs: readonly Id[] = []) => {
    const job = await service.store.get(id);
    const actorId = await context.services.get("projects").authorizeRequest(request, job.snapshot.scope, "read");
    await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const bound = { ...context, db: tx };
      await new AccessStore(bound).authorizeRead(request, job.snapshot.scope, actorId);
      await assertHistoryAccess(bound, { actorId, projectId: job.snapshot.scope.projectId, snapshotId: job.snapshot.id });
      for (const sourceId of comparisonJobs) {
        const source = await service.store.withTransaction(tx).get(sourceId);
        if (source.snapshot.scope.projectId !== job.snapshot.scope.projectId) throw new ServiceError("SCOPE_MISMATCH", 400, "Comparison source belongs to another project");
        await new AccessStore(bound).authorizeRead(request, source.snapshot.scope, actorId);
        await assertHistoryAccess(bound, { actorId, projectId: source.snapshot.scope.projectId, snapshotId: source.snapshot.id });
      }
    });
    return job;
  };
  const comparisonJobs = async (artifact: Artifact): Promise<readonly Id[]> => {
    switch (artifact.kind) {
      case "diff": break;
      case "pdf": case "dvi": case "log": case "synctex": case "generated": return [];
      default: return assertNever(artifact.kind);
    }
    const candidates = await context.db.all<{ result_json: string }>(
      "SELECT result_json FROM operations WHERE kind='pdf-diff' AND status='succeeded' AND result_json LIKE ?", [`%${artifact.id}%`]);
    for (const candidate of candidates) {
      const source = z.object({ artifactId: IdSchema, previewArtifactId: IdSchema,
        pages: z.array(z.object({ id: IdSchema })), fromJobId: IdSchema, toJobId: IdSchema }).parse(JSON.parse(candidate.result_json));
      if (source.artifactId === artifact.id || source.previewArtifactId === artifact.id || source.pages.some(page => page.id === artifact.id)) {
        return [source.fromJobId, source.toJobId];
      }
    }
    throw new ServiceError("NOT_FOUND", 404, "Comparison artifact is not published");
  };
  context.routes.register(endpoints.environmentsList, async (_input, request) => {
    await actor(request.request);
    const rows = await context.db.all<{ manifest_json: string }>(
      "SELECT manifest_json FROM environments WHERE available=1 ORDER BY id", []);
    return rows.map(row => EnvironmentSchema.parse(JSON.parse(row.manifest_json)));
  });
  context.routes.register(endpoints.compileCreate, async (input, request) => {
    if (input.params.p !== input.body.scope.projectId) throw new ServiceError("SCOPE_MISMATCH", 400, "Project scope mismatch");
    return service.enqueue(await actor(request.request), input.body, z.string().min(1).parse(input.headers["idempotency-key"]));
  });
  context.routes.register(endpoints.compilePreview, async (input, request) => {
    request.responseHeaders.set("cache-control", "private, no-store");
    const scope = { projectId: input.params.p, branch: input.query.branch };
    const result = await branchPreview(context, request.request, scope);
    const actorId = await context.services.get("projects").authorizeRequest(request.request, scope, "read");
    await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const bound = { ...context, db: tx };
      await new AccessStore(bound).authorizeRead(request.request, scope, actorId);
      for (const snapshot of [result.job?.snapshot, result.preview?.snapshot]) {
        if (snapshot) await assertHistoryAccess(bound, { actorId, projectId: scope.projectId, snapshotId: snapshot.id });
      }
    });
    return result;
  });
  context.routes.register(endpoints.compileGet, async (input, request) => {
    const job = await readJob(request.request, input.params.id);
    request.responseHeaders.set("cache-control", "private, no-store");
    request.responseHeaders.set("etag", resourceVersionTag((await service.store.raw(job.id)).version));
    const preview = z.object({ artifact_id: z.string() }).nullable().parse((await context.db.get("SELECT artifact_id FROM compiler_previews WHERE project_id=? AND branch=?", [job.snapshot.scope.projectId, job.snapshot.scope.branch])));
    if (preview) {
      const latest = await service.store.artifactById(IdSchema.parse(preview.artifact_id));
      const current = z.object({ revision: z.number() }).nullable().parse((await context.db.get("SELECT revision FROM branch_workspaces WHERE project_id=? AND branch=?", [job.snapshot.scope.projectId, job.snapshot.scope.branch])));
      request.responseHeaders.set("x-last-successful-artifact-id", preview.artifact_id);
      request.responseHeaders.set("x-preview-stale", String(job.status !== "succeeded" ||
        latest.jobId !== job.id || (current !== null && current.revision > job.snapshot.revision)));
    }
    return job;
  });
  context.routes.register(endpoints.compileCancel, async (input, request) => {
    const user = await actor(request.request);
    await service.cancel(user, input.params.id, input.body.expectedVersion);
    return { ok: true as const, version: (await service.store.raw(input.params.id)).version };
  });
  context.routes.register(endpoints.compileLog, async (input, request) => {
    const job = await readJob(request.request, input.params.id);
    request.responseHeaders.set("cache-control", "private, no-store");
    const log = job.artifacts.find((item) => item.name === "build.log");
    request.responseHeaders.set("content-type", "text/plain; charset=utf-8");
    const bytes = log ? new Uint8Array(await context.blobs.get(log.sha256)) : new Uint8Array();
    await readJob(request.request, job.id);
    return bytes;
  });
  context.routes.register(endpoints.artifactContent, async (input, request) => {
    const artifact = await service.store.artifactById(input.params.id);
    const sources = await comparisonJobs(artifact);
    const job = await readJob(request.request, artifact.jobId, sources);
    request.responseHeaders.set("cache-control", "private, no-store");
    request.responseHeaders.set("content-type", artifact.mime);
    request.responseHeaders.set("content-disposition", `attachment; filename="${artifact.name.replace(/["\r\n]/g, "")}"`);
    if (artifact.kind === "pdf") request.responseHeaders.set("x-artifact-partial", String(job.status !== "succeeded"));
    const bytes = new Uint8Array(await context.blobs.get(artifact.sha256));
    await readJob(request.request, job.id, sources);
    return bytes;
  });
  context.routes.register(endpoints.compileCacheDelete, async (input, request) => {
    const user = await actor(request.request);
    if (input.params.p !== input.body.scope.projectId) throw new ServiceError("SCOPE_MISMATCH", 400, "Project scope mismatch");
    await context.services.get("projects").authorize(user, input.body.scope, "compile");
    const version = z.object({ version: z.number() }).parse((await context.db.get("SELECT version FROM projects WHERE id=?", [input.params.p])));
    if (version.version !== input.body.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Project version changed");
    (await context.db.run("DELETE FROM compiler_cache WHERE project_id=? AND branch=?", [input.params.p, input.body.scope.branch]));
    return { ok: true as const, version: version.version };
  });
  context.routes.register(endpoints.synctex, async (input, request) => {
    const result = await service.task(syncTex(service, await actor(request.request), input));
    await readJob(request.request, input.params.id);
    return result;
  });
  context.routes.register(endpoints.pdfDiff, async (input, request) => service.task(pdfDifference(service, await actor(request.request), input)));
  const leases = registerWorkerRoutes(context, service);
  const reaper = setInterval(() => { service.runBackground(context.admission.background(() => leases.reap())); }, 10000);
  reaper.unref();
  service.leaseTimer = reaper;
  // Registration does not start compilation. The owning process invokes startWorker and awaits stopWorker before closing DB.
}
