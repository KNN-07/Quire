import { zipSync } from "fflate";
import { endpoints, ProjectPathSchema, DigestSchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import type { CompilerService } from "./service";
import { CompilerLeases } from "./leases";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sandbox, defaultLimits } from "../../workers/compiler/sandbox";
import { z } from "zod";
import { validPdfReceipt } from "./pdf-receipt";

export function registerWorkerRoutes(context: ModuleContext, service: CompilerService): CompilerLeases {
  const leases = new CompilerLeases(service);
  context.routes.register(endpoints.workerLease, async (input, request) => {
    leases.authorize(request.request);
    const lease = await leases.lease(input.body.workerId, input.body.environmentIds);
    if (lease) request.responseHeaders.set("x-job-capability", leases.capability(lease.jobId, lease));
    return { lease };
  });
  context.routes.register(endpoints.workerHeartbeat, async (input, request) => {
    leases.authorize(request.request); await leases.heartbeat(input.params.id, input.body);
    return { ok: true as const, version: (await service.store.raw(input.params.id)).version };
  });
  context.routes.register(endpoints.workerSource, async (input, request) => {
    leases.authorize(request.request); await leases.fence(input.params.id, input.query, request.request);
    const job = await service.store.get(input.params.id);
    const snapshot = await context.services.get("projects").readSnapshot(job.snapshot.id);
    if (snapshot.files.reduce((total, file) => total + file.bytes, 0) > (await service.limits(job.id)).workspaceBytes) {
      throw new ServiceError("SOURCE_LIMIT", 422, "Snapshot is larger than the compile workspace budget");
    }
    const files: Record<string, Uint8Array> = {};
    for (const file of snapshot.files) if (file.kind === "file" && file.blob) {
      files[`source/${ProjectPathSchema.parse(file.path)}`] = await context.blobs.get(file.blob);
    }
    files[".quire-worker-manifest.json"] = new TextEncoder().encode(JSON.stringify({
      files: snapshot.files, environment: await service.resolveEnvironment(job.environmentId),
    }));
    request.responseHeaders.set("content-type", "application/zip");
    return new Uint8Array(zipSync(files));
  });
  context.routes.register(endpoints.workerArtifact, async (input, request) => {
    leases.authorize(request.request); await leases.fence(input.params.id, input.query, request.request);
    if (request.request.headers.get("if-match") !== `"v${input.query.fencingToken}"`) {
      throw new ServiceError("STALE_LEASE", 409, "Artifact fencing version mismatch");
    }
    const name = ProjectPathSchema.parse(input.params.name);
    if (input.body.length > 64 * 1024 * 1024) throw new ServiceError("INVALID_ARTIFACT", 422, "Artifact must be a bounded generated file");
    const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(input.body).digest("hex"));
    if (request.request.headers.get("x-content-sha256") !== digest) throw new ServiceError("DIGEST_MISMATCH", 422, "Artifact digest required");
    if (name.endsWith(".pdf")) {
      if (new TextDecoder().decode(input.body.subarray(0, 5)) !== "%PDF-") throw new ServiceError("INVALID_PDF", 422, "Invalid PDF signature");
      const job = await service.store.get(input.params.id);
      const environment = await service.resolveEnvironment(job.environmentId);
      if (environment.backend === "docker") {
        if (!validPdfReceipt(leases.bearer(), {
          jobId: job.id, ...input.query, environmentId: environment.id,
          imageDigest: environment.rootOrImageDigest, name, digest,
        }, request.request.headers.get("x-pdf-validation"))) {
          throw new ServiceError("PDF_VALIDATION_REQUIRED", 422, "Confined worker PDF validation receipt required");
        }
      } else {
        const root = await mkdtemp(join(tmpdir(), "quire-pdf-validation-"));
        try {
          await writeFile(join(root, "document.pdf"), input.body);
          const validation = await sandbox({ source: root, limits: defaultLimits, signal: service.shutdown.signal,
            installationWork: { kind: "pdf-validate", file: ProjectPathSchema.parse("document.pdf") },
            command: ["pdftoppm", "-scale-to", "16", "/src/document.pdf", "/work/validation"] });
          if (validation.code !== 0 || validation.canceled) throw new ServiceError("INVALID_PDF", 422, "PDF pages cannot be rendered");
        } finally { await rm(root, { recursive: true, force: true }); }
      }
    }
    const artifact = await service.store.artifact({ jobId: input.params.id, name, bytes: input.body,
      kind: name.endsWith(".pdf") ? "pdf" : name.endsWith(".dvi") ? "dvi" : name.endsWith(".synctex.gz") ? "synctex" : name.endsWith(".log") ? "log" : "generated",
      mime: name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" },
      tx => leases.fence(input.params.id, input.query, request.request, tx));
    return { id: artifact.id };
  });
  context.routes.register(endpoints.workerComplete, async (input, request) => {
    leases.authorize(request.request);
    const key = z.string().min(1).parse(input.headers["idempotency-key"]);
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input.body)).digest("hex");
    const previous = z.object({ key: z.string(), digest: z.string(), version: z.number() }).nullable().parse(
      (await context.db.get("SELECT key,digest,version FROM compiler_completions WHERE job_id=?", [input.params.id])));
    if (previous) {
      if (previous.key !== key || previous.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Worker completion is immutable");
      return { ok: true as const, version: previous.version };
    }
    await leases.fence(input.params.id, input.body);
    const job = await service.store.get(input.params.id);
    const snapshot = await context.services.get("projects").readSnapshot(job.snapshot.id);
    if (input.body.diagnostics.some((item) => item.jobId !== job.id ||
      (item.fileId && !snapshot.files.some((file) => file.id === item.fileId)))) {
      throw new ServiceError("INVALID_DIAGNOSTIC", 422, "Diagnostic does not belong to this snapshot");
    }
    if (input.body.status === "succeeded") {
      const pdf = job.artifacts.find((item) => item.name === "output.pdf");
      if (!pdf || new TextDecoder().decode((await context.blobs.get(pdf.sha256)).subarray(0, 5)) !== "%PDF-") {
        throw new ServiceError("INVALID_PDF", 422, "Successful worker result requires a PDF");
      }
    }
    const result = await context.uow.run(async tx => {
      await tx.lock("quire:compiler");
      const replay = z.object({key:z.string(),digest:z.string(),version:z.number()}).nullable().parse(
        await tx.get("SELECT key,digest,version FROM compiler_completions WHERE job_id=?",[job.id]));
      if (replay) {
        if (replay.key !== key || replay.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT",409,"Worker completion is immutable");
        return {ok:true as const,version:replay.version};
      }
      await leases.fence(job.id,input.body,undefined,tx);
      const bound = service.store.withTransaction(tx);
      const current = await bound.get(job.id);
      const included = new Set(input.body.artifactIds);
      if (included.size !== input.body.artifactIds.length || included.size !== current.artifacts.length ||
        current.artifacts.some(item => !included.has(item.id))) throw new ServiceError("INVALID_ARTIFACT",422,"Completion must identify exactly this lease's artifacts");
      const version = (await bound.raw(job.id)).version+1;
      const completed = {...current,status:input.body.status,diagnostics:input.body.diagnostics,
        elapsedMs:input.body.elapsedMs,failureCode:input.body.failureCode,finishedAt:context.clock.now()};
      await bound.save(tx,completed);
      const publication = z.object({preview:z.number(),cache_key:z.string().nullable()}).parse(
        await tx.get("SELECT preview,cache_key FROM compiler_requests WHERE job_id=?",[job.id]));
      if (input.body.status === "succeeded" && publication.preview) await service.publishPreview(tx,job.id);
      if (input.body.status === "succeeded" && publication.cache_key) {
        await tx.run(`INSERT INTO compiler_cache(cache_key,project_id,branch,job_id) VALUES(?,?,?,?)
          ON CONFLICT(cache_key) DO UPDATE SET job_id=excluded.job_id`,
          [publication.cache_key,current.snapshot.scope.projectId,current.snapshot.scope.branch,job.id]);
      }
      await tx.run("UPDATE workers SET state='idle',job_id=NULL,builds_today=builds_today+1 WHERE job_id=?",[job.id]);
      await tx.run("DELETE FROM worker_leases WHERE job_id=?",[job.id]);
      await tx.run("INSERT INTO compiler_completions(job_id,key,digest,version) VALUES(?,?,?,?)",[job.id,key,digest,version]);
      await bound.changed(tx,completed);
      return {ok:true as const,version};
    });
    await context.events.dispatch();
    return result;
  });
  return leases;
}
