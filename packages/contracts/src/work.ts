import { z } from "zod";
import { IdSchema, InstantSchema, DigestSchema, CountSchema, ScopeSchema,
  JobStatusSchema, CapabilitySchema } from "./primitives";
import { CompileSettingsSchema, SnapshotSchema, SuggestionSchema } from "./projects";
import { PolicySchema } from "./accounts";

export const CompileRequestSchema = z.strictObject({
  scope: ScopeSchema, expectedRevision: CountSchema, settings: CompileSettingsSchema.optional(), clean: z.boolean(),
}).readonly();
export const ArtifactSchema = z.strictObject({
  id: IdSchema, jobId: IdSchema, name: z.string(), mime: z.string(), bytes: CountSchema,
  sha256: DigestSchema, kind: z.enum(["pdf", "dvi", "log", "synctex", "generated", "diff"]),
}).readonly();
export const DiagnosticSchema = z.strictObject({
  id: IdSchema, jobId: IdSchema, severity: z.enum(["error", "warning", "typesetting"]),
  message: z.string(), fileId: IdSchema.nullable(), line: CountSchema.nullable(), column: CountSchema.nullable(),
  rawStart: CountSchema, rawEnd: CountSchema,
}).readonly();
export const CompileJobSchema = z.strictObject({
  id: IdSchema, snapshot: SnapshotSchema, status: JobStatusSchema, environmentId: IdSchema,
  queuedAt: InstantSchema, startedAt: InstantSchema.nullable(), finishedAt: InstantSchema.nullable(),
  elapsedMs: CountSchema.nullable(), diagnostics: z.array(DiagnosticSchema).readonly(),
  artifacts: z.array(ArtifactSchema).readonly(), failureCode: z.string().nullable(), workerId: IdSchema.nullable(),
}).readonly();
export const OperationSchema = z.strictObject({
  id: IdSchema, kind: z.string(), status: JobStatusSchema, progress: z.number().min(0).max(1),
  result: z.record(z.string(), z.unknown()).nullable(), errorCode: z.string().nullable(),
}).readonly();
export const OperationSummarySchema = OperationSchema.unwrap().extend({
  createdAt: InstantSchema, updatedAt: InstantSchema,
}).readonly();
export const PublicationSchema = z.strictObject({
  provider: z.string(), providerId: z.string(), title: z.string(), authors: z.array(z.string()).readonly(),
  year: z.number().int().nullable(), doi: z.string().nullable(), url: z.string().nullable(), bibtex: z.string(),
}).readonly();
export const LibraryEntrySchema = z.strictObject({
  id: IdSchema, ownerId: IdSchema, citationKey: z.string(), bibtex: z.string(),
  origin: z.enum(["manual", "doi", "provider"]), providerId: z.string().nullable(),
  readonly: z.boolean(), publication: PublicationSchema.nullable(), version: CountSchema,
}).readonly();
export const ProviderConfigSchema = z.strictObject({
  id: IdSchema, kind: z.string(), baseUrl: z.string(), model: z.string().optional(), enabled: z.boolean(),
  secretPresent: z.boolean(), capabilities: z.record(z.string(), CapabilitySchema),
  policy: PolicySchema, version: CountSchema,
  aiPolicy: z.strictObject({
    requestLogging: z.enum(["off", "metadata", "retained-content"]),
    citationWebSearch: z.boolean(), blockConfidentialTags: z.boolean(), version: CountSchema,
  }).readonly().optional(),
}).readonly();
export const AiToolSchema = z.enum([
  "chat", "texgpt", "error-fix", "table-prompt", "table-image", "equation-prompt", "equation-image",
  "grammar", "fluency", "paraphrase", "concise", "scientific", "split", "join", "synonyms",
  "title", "abstract", "translate", "inline-completion", "citation-reviewer",
]);
export type AiTool = z.infer<typeof AiToolSchema>;
export const AiClaimAssessmentSchema = z.strictObject({
  fileId: IdSchema, path: z.string().min(1), from: CountSchema, to: CountSchema,
  quote: z.string().min(1).max(262144), assessment: z.enum(["supported", "unsupported"]),
  explanation: z.string().min(1).max(8192),
  citations: z.array(z.strictObject({ provider: z.string().min(1), providerId: z.string().min(1) })).max(100),
});
export const AiClaimFindingSchema = AiClaimAssessmentSchema.extend({
  revision: CountSchema, epoch: CountSchema,
}).readonly();
export type AiClaimFinding = z.infer<typeof AiClaimFindingSchema>;
export const AiRunStepSchema = z.strictObject({
  kind: z.enum(["context", "retrieval", "provider", "validation", "publication"]),
  status: z.enum(["running", "succeeded", "failed", "canceled"]),
  startedAt: InstantSchema, finishedAt: InstantSchema.nullable(),
}).readonly();
export type AiRunStep = z.infer<typeof AiRunStepSchema>;
export const AiRunSchema = z.strictObject({
  id: IdSchema, scope: ScopeSchema, mode: z.enum(["ask", "agent"]), status: JobStatusSchema,
  tool: AiToolSchema, version: CountSchema, errorCode: z.string().nullable(), conversationId: IdSchema.nullable(),
  messages: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string() }).readonly()).readonly(),
  proposals: z.array(SuggestionSchema).readonly(), sources: z.array(PublicationSchema).readonly(), usageId: IdSchema,
  // Pre-reviewer stored runs and older provider fixtures have no structured findings.
  findings: z.array(AiClaimFindingSchema).max(100).readonly().default([]),
  findingsCurrent: z.boolean().default(false),
  // Older runs have no recorded execution history.
  steps: z.array(AiRunStepSchema).max(5).readonly().default([]),
}).readonly();
export const WorkerSchema = z.strictObject({
  id: IdSchema, poolId: IdSchema, state: z.enum(["idle", "busy", "draining", "offline"]),
  environmentIds: z.array(IdSchema).readonly(), jobId: IdSchema.nullable(), lastHeartbeat: InstantSchema,
  buildsToday: CountSchema,
}).readonly();
export const EnvironmentSchema = z.strictObject({
  id: IdSchema, label: z.string(), release: z.string(), backend: z.enum(["bwrap", "docker"]),
  rootOrImageDigest: z.string(), engines: z.array(CompileSettingsSchema.unwrap().shape.engine).readonly(),
  helpers: z.array(z.string()).readonly(), packagesDigest: DigestSchema,
  experimental: z.boolean(), available: z.boolean(), probeAt: InstantSchema.nullable(),
}).readonly();
export const BackupSchema = z.strictObject({
  id: IdSchema, status: JobStatusSchema, createdAt: InstantSchema, manifestDigest: DigestSchema.nullable(),
  destination: z.string(), verifiedAt: InstantSchema.nullable(), operationId: IdSchema,
}).readonly();
export const ReleaseSchema = z.strictObject({
  id: IdSchema, version: z.string(), manifestDigest: DigestSchema, notes: z.string(),
  signatureVerified: z.boolean(), compatibleSchema: z.array(CountSchema).readonly(),
  scheduledAt: InstantSchema.nullable(),
}).readonly();
export const AdapterGrantSchema = z.strictObject({
  id: IdSchema, provider: z.string(), ownerId: IdSchema, label: z.string(), state: CapabilitySchema.unwrap().shape.state,
  scopes: z.array(z.string()).readonly(), expiresAt: InstantSchema.nullable(), version: CountSchema,
}).readonly();
export type CompileRequest = z.infer<typeof CompileRequestSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export type CompileJob = z.infer<typeof CompileJobSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type OperationSummary = z.infer<typeof OperationSummarySchema>;
export type Publication = z.infer<typeof PublicationSchema>;
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type AiRun = z.infer<typeof AiRunSchema>;
export type Worker = z.infer<typeof WorkerSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type Backup = z.infer<typeof BackupSchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type AdapterGrant = z.infer<typeof AdapterGrantSchema>;
