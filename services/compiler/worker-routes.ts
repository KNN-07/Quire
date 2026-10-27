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

export function registerWorkerRoutes(context: ModuleContext, service: CompilerService): CompilerLeases {
  const leases = new CompilerLeases(service);
  context.routes.register(endpoints.workerLease, (input, request) => {
    leases.authorize(request.request);
    const lease = leases.lease(input.body.workerId, input.body.environmentIds);
    if (lease) request.responseHeaders.set("x-job-capability", leases.capability(lease.jobId, lease));
    return { lease };
  });
  context.routes.register(endpoints.workerHeartbeat, (input, request) => {
    leases.authorize(request.request); leases.heartbeat(input.params.id, input.body);
    return { ok: true as const, version: service.store.raw(input.params.id).version };
  });
  context.routes.register(endpoints.workerSource, async (input, request) => {
    leases.authorize(request.request); leases.fence(input.params.id, input.query, request.request);
    const job = service.store.get(input.params.id);
    const snapshot = await context.services.get("projects").readSnapshot(job.snapshot.id);
    if (snapshot.files.reduce((total, file) => total + file.bytes, 0) > service.limits(job.id).workspaceBytes) {
      throw new ServiceError("SOURCE_LIMIT", 422, "Snapshot is larger than the compile workspace budget");
    }
    const files: Record<string, Uint8Array> = {};
    for (const file of snapshot.files) if (file.kind === "file" && file.blob) {
      files[`source/${ProjectPathSchema.parse(file.path)}`] = await context.blobs.get(file.blob);
    }
    files[".quire-worker-manifest.json"] = new TextEncoder().encode(JSON.stringify({
      files: snapshot.files, environment: service.environment,
    }));
    request.responseHeaders.set("content-type", "application/zip");
    return new Uint8Array(zipSync(files));
  });
  context.routes.register(endpoints.workerArtifact, async (input, request) => {
    leases.authorize(request.request); leases.fence(input.params.id, input.query, request.request);
    if (request.request.headers.get("if-match") !== `"v${input.query.fencingToken}"`) {
      throw new ServiceError("STALE_LEASE", 409, "Artifact fencing version mismatch");
    }
    const name = ProjectPathSchema.parse(input.params.name);
    if (input.body.length > 64 * 1024 * 1024) throw new ServiceError("INVALID_ARTIFACT", 422, "Artifact must be a bounded generated file");
    const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(input.body).digest("hex"));
    if (request.request.headers.get("x-content-sha256") !== digest) throw new ServiceError("DIGEST_MISMATCH", 422, "Artifact digest required");
    const previous = service.store.get(input.params.id).artifacts.find((item) => item.name === name);
    if (previous) {
      if (previous.sha256 !== digest) throw new ServiceError("ARTIFACT_CONFLICT", 409, "Immutable artifact already exists");
      return { id: previous.id };
    }
    if (name.endsWith(".pdf")) {
      if (new TextDecoder().decode(input.body.subarray(0, 5)) !== "%PDF-") throw new ServiceError("INVALID_PDF", 422, "Invalid PDF signature");
      const root = await mkdtemp(join(tmpdir(), "quire-pdf-validation-"));
      try {
        await writeFile(join(root, "document.pdf"), input.body);
        const validation = await sandbox({ source: root, limits: defaultLimits, signal: service.shutdown.signal,
          command: ["pdftoppm", "-scale-to", "16", "/src/document.pdf", "/work/validation"] });
        if (validation.code !== 0 || validation.canceled) throw new ServiceError("INVALID_PDF", 422, "PDF pages cannot be rendered");
      } finally { await rm(root, { recursive: true, force: true }); }
    }
    const artifact = await service.store.artifact({ jobId: input.params.id, name, bytes: input.body,
      kind: name.endsWith(".pdf") ? "pdf" : name.endsWith(".dvi") ? "dvi" : name.endsWith(".synctex.gz") ? "synctex" : name.endsWith(".log") ? "log" : "generated",
      mime: name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" },
      () => leases.fence(input.params.id, input.query, request.request));
    return { id: artifact.id };
  });
  context.routes.register(endpoints.workerComplete, async (input, request) => {
    leases.authorize(request.request);
    const key = z.string().min(1).parse(input.headers["idempotency-key"]);
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input.body)).digest("hex");
    const previous = z.object({ key: z.string(), digest: z.string(), version: z.number() }).nullable().parse(
      context.db.query("SELECT key,digest,version FROM compiler_completions WHERE job_id=?").get(input.params.id));
    if (previous) {
      if (previous.key !== key || previous.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Worker completion is immutable");
      return { ok: true as const, version: previous.version };
    }
    leases.fence(input.params.id, input.body);
    const job = service.store.get(input.params.id);
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
    const replay = z.object({ key: z.string(), digest: z.string(), version: z.number() }).nullable().parse(
      context.db.query("SELECT key,digest,version FROM compiler_completions WHERE job_id=?").get(input.params.id));
    if (replay) {
      if (replay.key !== key || replay.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Worker completion is immutable");
      return { ok: true as const, version: replay.version };
    }
    leases.fence(input.params.id, input.body);
    const current = service.store.get(job.id);
    const included = new Set(input.body.artifactIds);
    if (included.size !== input.body.artifactIds.length || included.size !== current.artifacts.length ||
      current.artifacts.some((item) => !included.has(item.id))) throw new ServiceError("INVALID_ARTIFACT", 422, "Completion must identify exactly this lease's artifacts");
    const version = service.store.raw(input.params.id).version + 1;
    service.store.save({ ...current, status: input.body.status, diagnostics: input.body.diagnostics,
      elapsedMs: input.body.elapsedMs, failureCode: input.body.failureCode, finishedAt: context.clock.now() }, () => {
      if (input.body.status === "succeeded") service.publishPreview(job.id);
      context.db.query("UPDATE workers SET state='idle',job_id=NULL,builds_today=builds_today+1 WHERE job_id=?").run(job.id);
      context.db.query("DELETE FROM worker_leases WHERE job_id=?").run(job.id);
      context.db.query("INSERT INTO compiler_completions(job_id,key,digest,version) VALUES(?,?,?,?)")
        .run(job.id, key, digest, version);
    });
    return { ok: true as const, version };
  });
  return leases;
}
