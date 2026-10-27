import { z } from "zod";
import { endpoints, EnvironmentSchema, resourceVersionTag, IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { CompilerService } from "./service";
import { probeEnvironment } from "./environment";
import { syncTex } from "./navigation";
import { pdfDifference } from "./diff";
import { registerWorkerRoutes } from "./worker-routes";
export { migrations } from "./store";
export { CompilerService } from "./service";
export { CompilerLeases } from "./leases";
export { nativeEnvironmentId, probeEnvironment } from "./environment";
export { defaultLimits } from "../../workers/compiler/sandbox";
export { runRemoteWorker } from "../../workers/compiler/remote";
export { workerMain } from "../../workers/compiler/main";

const instances = new WeakMap<object, CompilerService>();
let nativeProbe: ReturnType<typeof probeEnvironment> | null = null;
export async function startWorker(context: Pick<ModuleContext, "services">): Promise<void> {
  const service = instances.get(context.services);
  if (!service) throw new ServiceError("COMPILER_NOT_REGISTERED", 503, "Register compiler before starting worker");
  await service.start();
}
export async function stopWorker(context: Pick<ModuleContext, "services">): Promise<void> {
  await instances.get(context.services)?.stop();
}
export async function register(context: ModuleContext): Promise<void> {
  if (context.config.compilerBackend !== "bwrap") {
    throw new ServiceError("COMPILER_BACKEND_UNAVAILABLE", 503, "Docker compilation requires O's provisioned, digest-pinned TeX image; native bwrap is the verified backend");
  }
  nativeProbe ??= probeEnvironment();
  const environment = await nativeProbe;
  context.db.query(`INSERT INTO environments(id,label,release,backend,manifest_json,available,probe_at,created_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,release=excluded.release,
    manifest_json=excluded.manifest_json,available=excluded.available,probe_at=excluded.probe_at`)
    .run(environment.id, environment.label, environment.release, environment.backend, JSON.stringify(environment),
      Number(environment.available), environment.probeAt, context.clock.now());
  const service = new CompilerService(context, environment);
  context.services.provide("compiler", service);
  instances.set(context.services, service);
  const actor = async (request: Request): Promise<Id> => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request);
    if (!["GET", "HEAD"].includes(request.method)) await identity.verifyMutation(request, principal);
    return principal.user.id;
  };
  context.routes.register(endpoints.environmentsList, async (_input, request) => {
    await actor(request.request);
    return [EnvironmentSchema.parse(environment)];
  });
  context.routes.register(endpoints.compileCreate, async (input, request) => {
    if (input.params.p !== input.body.scope.projectId) throw new ServiceError("SCOPE_MISMATCH", 400, "Project scope mismatch");
    return service.enqueue(await actor(request.request), input.body, z.string().min(1).parse(input.headers["idempotency-key"]));
  });
  context.routes.register(endpoints.compileGet, async (input, request) => {
    const job = await service.get(await actor(request.request), input.params.id);
    request.responseHeaders.set("etag", resourceVersionTag(service.store.raw(job.id).version));
    const preview = z.object({ artifact_id: z.string() }).nullable().parse(context.db.query(
      "SELECT artifact_id FROM compiler_previews WHERE project_id=? AND branch=?")
      .get(job.snapshot.scope.projectId, job.snapshot.scope.branch));
    if (preview) {
      const latest = service.store.artifactById(IdSchema.parse(preview.artifact_id));
      const current = z.object({ revision: z.number() }).nullable().parse(context.db.query(
        "SELECT revision FROM branch_workspaces WHERE project_id=? AND branch=?")
        .get(job.snapshot.scope.projectId, job.snapshot.scope.branch));
      request.responseHeaders.set("x-last-successful-artifact-id", preview.artifact_id);
      request.responseHeaders.set("x-preview-stale", String(job.status !== "succeeded" ||
        latest.jobId !== job.id || (current !== null && current.revision > job.snapshot.revision)));
    }
    return job;
  });
  context.routes.register(endpoints.compileCancel, async (input, request) => {
    const user = await actor(request.request);
    await service.get(user, input.params.id);
    if (service.store.raw(input.params.id).version !== input.body.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Compile version changed");
    await service.cancel(user, input.params.id); return { ok: true as const, version: service.store.raw(input.params.id).version };
  });
  context.routes.register(endpoints.compileLog, async (input, request) => {
    const job = await service.get(await actor(request.request), input.params.id);
    const log = job.artifacts.find((item) => item.name === "build.log");
    request.responseHeaders.set("content-type", "text/plain; charset=utf-8");
    return log ? new Uint8Array(await context.blobs.get(log.sha256)) : new Uint8Array();
  });
  context.routes.register(endpoints.artifactContent, async (input, request) => {
    const artifact = service.store.artifactById(input.params.id);
    const job = await service.get(await actor(request.request), artifact.jobId);
    request.responseHeaders.set("content-type", artifact.mime);
    request.responseHeaders.set("content-disposition", `attachment; filename="${artifact.name.replace(/["\r\n]/g, "")}"`);
    if (artifact.kind === "pdf") request.responseHeaders.set("x-artifact-partial", String(job.status !== "succeeded"));
    return new Uint8Array(await context.blobs.get(artifact.sha256));
  });
  context.routes.register(endpoints.compileCacheDelete, async (input, request) => {
    const user = await actor(request.request);
    if (input.params.p !== input.body.scope.projectId) throw new ServiceError("SCOPE_MISMATCH", 400, "Project scope mismatch");
    await context.services.get("projects").authorize(user, input.body.scope, "compile");
    const version = z.object({ version: z.number() }).parse(context.db.query("SELECT version FROM projects WHERE id=?").get(input.params.p));
    if (version.version !== input.body.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Project version changed");
    context.db.query("DELETE FROM compiler_cache WHERE project_id=? AND branch=?")
      .run(input.params.p, input.body.scope.branch);
    return { ok: true as const, version: version.version };
  });
  context.routes.register(endpoints.synctex, async (input, request) => service.task(syncTex(service, await actor(request.request), input)));
  context.routes.register(endpoints.pdfDiff, async (input, request) => service.task(pdfDifference(service, await actor(request.request), input)));
  const leases = registerWorkerRoutes(context, service);
  const reaper = setInterval(() => leases.reap(), 10000);
  reaper.unref();
  service.leaseTimer = reaper;
  // Registration does not start compilation. The owning process invokes startWorker and awaits stopWorker before closing DB.
}
