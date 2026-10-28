import { z } from "zod";
import { DigestSchema, IdSchema, InstantSchema, ProjectPathSchema } from "@quire/contracts";
import { BindingSchema, ExecutionIdentitySchema } from "./model";
import { PackageSchema } from "../environments/inputs";

export const ExecutionLimitsSchema = z.strictObject({
  wallSeconds: z.number().int().min(1).max(86400),
  memoryBytes: z.number().int().min(16 * 1024 * 1024).max(16 * 1024 * 1024 * 1024),
  processes: z.number().int().min(1).max(1024),
  workspaceBytes: z.number().int().min(1024).max(4 * 1024 * 1024 * 1024),
}).readonly();
const engine = z.enum(["pdflatex", "latex", "xelatex", "lualatex", "plain"]);
const profile = z.enum(["default", "restricted", "knitr"]);
export const ExecutionSourceSchema = z.strictObject({
  path: z.string().startsWith("/").max(4096), digest: DigestSchema,
}).readonly();
export const ExecutionWorkSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("compile"), source: ExecutionSourceSchema,
    engine, mainFile: ProjectPathSchema, draft: z.boolean(), stopOnFirstError: z.boolean() }),
  z.strictObject({ kind: z.literal("synctex-forward"), source: ExecutionSourceSchema,
    file: ProjectPathSchema, line: z.number().int().positive(), column: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("synctex-reverse"), source: ExecutionSourceSchema,
    page: z.number().int().positive(), xPt: z.number().finite(), yPt: z.number().finite() }),
  z.strictObject({ kind: z.literal("pdf-validate"), source: ExecutionSourceSchema, file: ProjectPathSchema }),
  z.strictObject({ kind: z.literal("pdf-diff-render"), source: ExecutionSourceSchema }),
  z.strictObject({ kind: z.literal("pdf-diff-compile"), source: ExecutionSourceSchema }),
  z.strictObject({ kind: z.literal("environment-metadata"), source: ExecutionSourceSchema }),
  z.strictObject({ kind: z.literal("environment-confinement"), source: ExecutionSourceSchema }),
  z.strictObject({ kind: z.literal("environment-fixture"), source: ExecutionSourceSchema, engine,
    mainFile: ProjectPathSchema }),
  z.strictObject({ kind: z.literal("environment-fonts"), source: ExecutionSourceSchema }),
  z.strictObject({ kind: z.literal("environment-build"), source: ExecutionSourceSchema,
    packages: z.array(PackageSchema).max(32).readonly(),
    mirror: z.url({ protocol: /^https?$/ }), operationId: IdSchema }),
  z.strictObject({ kind: z.literal("worker"), workerId: IdSchema,
    environmentIds: z.array(IdSchema).min(1).max(128).readonly() }),
]).readonly();
export type ExecutionWork = z.infer<typeof ExecutionWorkSchema>;
export const ExecutionKindSchema = z.enum([
  "compile", "synctex-forward", "synctex-reverse", "pdf-validate", "pdf-diff-render", "pdf-diff-compile",
  "environment-metadata", "environment-confinement", "environment-fixture",
  "environment-fonts", "environment-build", "worker",
]);
export const ExecutionProfileSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(128),
  roles: z.array(z.string().min(1).max(128)).min(1).max(128).readonly(),
  kinds: z.array(ExecutionKindSchema).min(1).readonly(),
  backend: z.enum(["bwrap", "docker", "worker"]),
  image: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  profile: profile.default("default"),
  limits: ExecutionLimitsSchema,
  maxConcurrent: z.number().int().min(1).max(128),
  workerRole: z.string().min(1).max(128).optional(),
  mirrors: z.array(z.url({ protocol: /^https?$/ })).max(16).readonly().default([]),
}).readonly();
export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;
export const ExecutionRequestSchema = z.strictObject({
  requestId: IdSchema, profileId: z.string().min(1).max(128),
  work: ExecutionWorkSchema, limits: ExecutionLimitsSchema,
}).readonly();
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;
export const ExecutionExitSchema = z.strictObject({
  id: IdSchema, code: z.number().int().nullable(), canceled: z.boolean(),
  interrupted: z.boolean(), stdoutBytes: z.number().int().nonnegative(),
  stderrBytes: z.number().int().nonnegative(), image: z.string().nullable(),
}).readonly();
export type ExecutionExit = z.infer<typeof ExecutionExitSchema>;
export const ExecutionLaunchSchema = z.strictObject({
  id: IdSchema, parentExecutionId: IdSchema, installationId: z.string(),
  supervisorEpoch: IdSchema, generation: z.number().int().nonnegative(),
  binding: BindingSchema, request: ExecutionRequestSchema, requestDigest: DigestSchema,
  profile: ExecutionProfileSchema, unit: z.string().min(1), root: z.string().startsWith("/"),
  containerName: z.string().nullable(), containerId: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  executionId: IdSchema.nullable(), createdAt: InstantSchema,
  payloadStartedAt: InstantSchema.nullable().default(null),
  state: z.enum(["reserved", "starting", "running", "stopping", "exited", "interrupted", "released"]),
  result: ExecutionExitSchema.nullable(),
  report: ExecutionExitSchema.nullable().default(null),
}).readonly();
export type ExecutionLaunch = z.infer<typeof ExecutionLaunchSchema>;
export const ExecutionTaskSchema = z.strictObject({
  launchId: IdSchema, request: ExecutionRequestSchema, profile: ExecutionProfileSchema,
  root: z.string().startsWith("/"), source: z.string().startsWith("/").nullable(),
  containerId: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  dockerSocket: z.string().startsWith("/").nullable(),
}).readonly();
export type ExecutionTask = z.infer<typeof ExecutionTaskSchema>;
export const ExecutionSnapshotSchema = z.strictObject({
  launch: ExecutionLaunchSchema, execution: ExecutionIdentitySchema.nullable(),
  pid: z.number().int().positive().nullable(),
}).readonly();
export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshotSchema>;
export interface ExecutionChunk {
  readonly bytes: Uint8Array;
  readonly nextOffset: number;
  readonly complete: boolean;
}
export interface OwnedExecution {
  readonly id: z.infer<typeof IdSchema>;
  readonly started: Promise<ExecutionSnapshot>;
  readonly exited: Promise<ExecutionExit>;
  read(stream: "stdout" | "stderr", offset: number, maximumBytes?: number): Promise<ExecutionChunk>;
  stop(): Promise<ExecutionExit>;
  release(): Promise<void>;
}
export interface InstallationExecutionClient {
  start(request: ExecutionRequest): Promise<OwnedExecution>;
  inspect(id: z.infer<typeof IdSchema>): Promise<ExecutionSnapshot>;
}
