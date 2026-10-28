import { z } from "zod";
import { routesFor, none, noBody, list, version, key } from "./route-builders";
import { IdSchema as id, CountSchema, ScopeSchema, OkSchema, BranchSchema } from "./primitives";
import { IdParamsSchema as ids, ProjectParamsSchema as p, BytesSchema } from "./endpoint";
import { CompileJobSchema, CompileRequestSchema, OperationSchema, EnvironmentSchema,
  DiagnosticSchema, ArtifactSchema } from "./work";
import { CompileSettingsSchema, SnapshotSchema } from "./projects";

const r = routesFor("C");
export const WorkerLeaseSchema = z.strictObject({
  jobId: id, snapshotId: id, environmentId: id, settings: CompileSettingsSchema,
  limits: z.strictObject({ wallSeconds: z.number().positive().max(600), memoryBytes: CountSchema,
    processes: CountSchema, workspaceBytes: CountSchema }),
  attempt: CountSchema, fencingToken: CountSchema,
});
export type WorkerLease = z.infer<typeof WorkerLeaseSchema>;
const fence = { attempt: CountSchema, fencingToken: CountSchema } as const;
const fenceQuery = z.strictObject({
  attempt: z.coerce.number().int().nonnegative(), fencingToken: z.coerce.number().int().nonnegative(),
});
export const compilerEndpoints = {
  environmentsList: r("GET", "/api/environments", { params: none, query: none, body: noBody, output: z.array(EnvironmentSchema) }),
  compileCreate: r("POST", "/api/projects/:p/compiles", { params: p, query: none, body: CompileRequestSchema, output: CompileJobSchema, ...key, successStatus: 202 }),
  compileGet: r("GET", "/api/compiles/:id", { params: ids, query: none, body: noBody, output: CompileJobSchema }),
  compilePreview: r("GET", "/api/projects/:p/compile-preview", { params: p,
    query: z.strictObject({ branch: BranchSchema }), body: noBody,
    output: z.strictObject({ job: CompileJobSchema.nullable(),
      preview: z.strictObject({ artifact: ArtifactSchema, snapshot: SnapshotSchema, stale: z.boolean() }).readonly().nullable(),
    }).readonly() }),
  compileCancel: r("POST", "/api/compiles/:id/cancel", { params: ids, query: none, body: z.strictObject(version), output: OkSchema }),
  compileLog: r("GET", "/api/compiles/:id/log", { params: ids, query: list, body: noBody, output: BytesSchema, transport: "bytes" }),
  artifactContent: r("GET", "/api/artifacts/:id/content", { params: ids, query: none, body: noBody, output: BytesSchema, transport: "bytes" }),
  compileCacheDelete: r("DELETE", "/api/projects/:p/compile-cache", { params: p, query: none, body: z.strictObject({ scope: ScopeSchema, ...version }), output: OkSchema }),
  synctex: r("POST", "/api/compiles/:id/synctex", { params: ids, query: none, body: z.discriminatedUnion("direction", [
    z.strictObject({ direction: z.literal("forward"), fileId: id, line: CountSchema, column: CountSchema }),
    z.strictObject({ direction: z.literal("reverse"), page: CountSchema, xPt: z.number(), yPt: z.number() }),
  ]), output: z.union([
    z.array(z.strictObject({ page: CountSchema, xPt: z.number(), yPt: z.number(), widthPt: z.number(), heightPt: z.number() })),
    z.array(z.strictObject({ fileId: id, line: CountSchema, column: CountSchema })),
  ]) }),
  pdfDiff: r("POST", "/api/projects/:p/pdf-diffs", { params: p, query: none, body: z.strictObject({ fromSnapshotId: id, toSnapshotId: id, mode: z.enum(["side-by-side", "overlay"]) }), output: OperationSchema, ...key, successStatus: 202 }),
  workerLease: r("POST", "/internal/workers/lease", { params: none, query: none, body: z.strictObject({ workerId: id, environmentIds: z.array(id) }), output: z.strictObject({ lease: WorkerLeaseSchema.nullable() }) }),
  workerHeartbeat: r("POST", "/internal/jobs/:id/heartbeat", { params: ids, query: none, body: z.strictObject(fence), output: OkSchema }),
  workerSource: r("GET", "/internal/jobs/:id/source.zip", { params: ids, query: fenceQuery, body: noBody, output: BytesSchema, transport: "bytes" }),
  workerArtifact: r("PUT", "/internal/jobs/:id/artifacts/:name", { params: ids.extend({ name: z.string() }), query: fenceQuery, body: BytesSchema, output: z.strictObject({ id }), transport: "bytes", ifMatch: true }),
  workerComplete: r("POST", "/internal/jobs/:id/complete", { params: ids, query: none, body: z.strictObject({ ...fence, status: z.enum(["succeeded", "failed", "timeout", "canceled"]), diagnostics: z.array(DiagnosticSchema), artifactIds: z.array(id), elapsedMs: CountSchema, failureCode: z.string().nullable() }), output: OkSchema, ...key }),
} as const;
