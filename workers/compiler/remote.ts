import ky from "ky";
import { unzipSync } from "fflate";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { WorkerLeaseSchema, FileEntrySchema, DigestSchema, IdSchema, EnvironmentSchema } from "@quire/contracts";
import type { BlobStore, Id, Environment } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { workerEnvironments, assertEnvironmentIdentity, buildEnvironment } from "./profiles";
import { parseDiagnostics } from "../../services/compiler/diagnostics";
import { pdfValidationReceipt } from "../../services/compiler/pdf-receipt";
import { validateDockerPdf } from "./pdf-validation";

export type WorkerOptions = {
  readonly baseUrl: string; readonly bearer: string; readonly workerId: Id;
  readonly environmentIds: readonly Id[]; readonly signal: AbortSignal;
  readonly environments?: readonly Environment[];
};
export async function runRemoteWorker(options: WorkerOptions): Promise<void> {
  const environments = await workerEnvironments(options.environments, options.signal);
  if (options.signal.aborted) return;
  if (options.environmentIds.some(id => !environments.has(id))) {
    throw new ServiceError("WORKER_ENVIRONMENT_MISMATCH", 503, "Worker environment has not passed its confinement probe");
  }
  const http = ky.create({ prefixUrl: options.baseUrl.replace(/\/?$/, "/"), retry: 0,
    timeout: 15000, headers: { authorization: `Bearer ${options.bearer}` } });
  while (!options.signal.aborted) {
    const response = await http.post("internal/workers/lease", {
      json: { workerId: options.workerId, environmentIds: options.environmentIds }, signal: options.signal });
    const { lease } = z.object({ data: z.object({ lease: WorkerLeaseSchema.nullable() }) }).parse(await response.json()).data;
    if (!lease) {
      try { await delay(1000, undefined, { signal: options.signal }); }
      catch (error) { if (error instanceof Error && error.name === "AbortError") return; throw error; }
      continue;
    }
    const capability = response.headers.get("x-job-capability");
    if (!capability) throw new ServiceError("JOB_CAPABILITY_MISSING", 502, "Lease did not issue a job capability");
    const headers = { "x-job-capability": capability };
    const query = { attempt: lease.attempt, fencingToken: lease.fencingToken };
    const archive = unzipSync(new Uint8Array(await http.get(`internal/jobs/${lease.jobId}/source.zip`, {
      searchParams: query, headers, signal: options.signal }).arrayBuffer()));
    const manifest = archive[".quire-worker-manifest.json"];
    if (!manifest) throw new ServiceError("SOURCE_MANIFEST_MISSING", 422, "Worker source archive lacks file identities");
    const metadata = z.strictObject({ files: z.array(FileEntrySchema), environment: EnvironmentSchema })
      .parse(JSON.parse(new TextDecoder().decode(manifest)));
    const environment = environments.get(lease.environmentId);
    if (!environment || metadata.environment.id !== lease.environmentId || lease.settings.environmentId !== lease.environmentId) {
      throw new ServiceError("WORKER_ENVIRONMENT_MISMATCH", 409, "Worker lease and source manifest select different environments");
    }
    assertEnvironmentIdentity(metadata.environment, environment);
    const { files } = metadata;
    const source = new Map<string, Uint8Array>();
    for (const file of files) if (file.blob) {
      const bytes = archive[`source/${file.path}`];
      if (!bytes || new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== file.blob) {
        throw new ServiceError("SOURCE_DIGEST_MISMATCH", 422, "Worker source digest differs from immutable manifest");
      }
      source.set(file.blob, bytes);
    }
    const blobs: BlobStore = {
      get: async (digest) => {
        const bytes = source.get(digest);
        if (!bytes) throw new ServiceError("SOURCE_MISSING", 422, "Snapshot blob missing");
        return bytes;
      },
      put: async (bytes) => DigestSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")),
    };
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal.addEventListener("abort", onAbort, { once: true });
    let heartbeatError: Error | null = null;
    const heartbeat = setInterval(() => {
      void http.post(`internal/jobs/${lease.jobId}/heartbeat`, { json: query }).catch((error: unknown) => {
        if (!(error instanceof Error)) throw error;
        heartbeatError = error; controller.abort();
      });
    }, 10000);
    const started = performance.now();
    try {
      const result = await buildEnvironment({ files, blobs, settings: lease.settings, environment, limits: lease.limits,
        signal: controller.signal, unitId: lease.jobId });
      if (heartbeatError) throw heartbeatError;
      const artifacts = new Map(result.files);
      artifacts.set("build.log", new TextEncoder().encode(result.log));
      const artifactIds: Id[] = [];
      for (const [name, bytes] of artifacts) {
        if (/^(?:tmp|cache|texmf-var|texmf-config)\//.test(name) || name === "exit-code") continue;
        const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
        let validation: string | undefined;
        if (name.endsWith(".pdf") && environment.backend === "docker") {
          await validateDockerPdf(bytes, environment, controller.signal);
          validation = pdfValidationReceipt(options.bearer, {
            jobId: lease.jobId, ...query, environmentId: environment.id,
            imageDigest: environment.rootOrImageDigest, name, digest,
          });
        }
        const uploaded = await http.put(`internal/jobs/${lease.jobId}/artifacts/${encodeURIComponent(name)}`, {
          searchParams: query, body: new Uint8Array(bytes), headers: { ...headers, "if-match": `"v${lease.fencingToken}"`,
            ...(validation ? { "x-pdf-validation": validation } : {}),
            "x-content-sha256": digest }, signal: options.signal,
        }).json();
        artifactIds.push(z.object({ data: z.object({ id: IdSchema }) }).parse(uploaded).data.id);
      }
      await http.post(`internal/jobs/${lease.jobId}/complete`, {
        headers: { "idempotency-key": `${lease.jobId}:${lease.attempt}:${lease.fencingToken}` },
        json: { ...query, status: result.success ? "succeeded" : result.log.includes("result: timeout") ? "timeout" : "failed",
          diagnostics: parseDiagnostics({ jobId: lease.jobId, log: result.log, files }), artifactIds,
          elapsedMs: Math.round(performance.now() - started), failureCode: result.success ? null : "COMPILE_FAILED" },
        signal: options.signal,
      });
    } finally { clearInterval(heartbeat); options.signal.removeEventListener("abort", onAbort); }
  }
}
