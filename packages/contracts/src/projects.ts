import { z } from "zod";
import { IdSchema, InstantSchema, DigestSchema, GitOidSchema, CountSchema,
  ScopeSchema, VersionSchema, ProjectPathSchema, Base64Schema, RoleSchema } from "./primitives";

export const EngineSchema = z.enum(["pdflatex", "latex", "xelatex", "lualatex", "plain"]);
export const CompileSettingsSchema = z.strictObject({
  engine: EngineSchema, mainFileId: IdSchema, environmentId: IdSchema,
  draft: z.boolean(), stopOnFirstError: z.boolean(),
}).readonly();
export const ProjectSchema = z.strictObject({
  id: IdSchema, name: z.string(), ownerId: IdSchema, workspaceId: IdSchema.nullable(),
  defaultBranch: z.string(), settings: CompileSettingsSchema, version: CountSchema,
  createdAt: InstantSchema, updatedAt: InstantSchema,
}).readonly();
export const ProjectSummarySchema = ProjectSchema.unwrap().extend({
  ownerName: z.string(), tagIds: z.array(IdSchema).readonly(), role: RoleSchema,
}).readonly();
export const FileEntrySchema = z.strictObject({
  id: IdSchema, path: ProjectPathSchema, kind: z.enum(["file", "folder"]), mime: z.string(),
  blob: DigestSchema.nullable(), bytes: CountSchema, editable: z.boolean(), version: VersionSchema,
  link: z.strictObject({
    kind: z.enum(["project", "url", "bibliography"]), sourceId: z.string(),
    lastRefreshedAt: InstantSchema.nullable(),
  }).readonly().nullable(),
}).readonly();
export const TextDocumentSchema = z.strictObject({
  file: FileEntrySchema, text: z.string(), stateVectorBase64: Base64Schema, updateBase64: Base64Schema,
}).readonly();
export const SnapshotSchema = z.strictObject({
  id: IdSchema, scope: ScopeSchema, revision: CountSchema, tree: GitOidSchema,
  createdAt: InstantSchema, authorId: IdSchema,
  reason: z.enum(["checkpoint", "compile", "commit", "restore", "import"]),
}).readonly();
export const AnchorSchema = z.strictObject({
  fileId: IdSchema, epoch: CountSchema, startRelative: Base64Schema, endRelative: Base64Schema,
  quote: z.string(),
}).readonly();
export const ProposedEditSchema = z.strictObject({
  id: IdSchema, fileId: IdSchema, anchor: AnchorSchema, before: z.string(), after: z.string(),
  baseRevision: CountSchema, status: z.enum(["pending", "accepted", "rejected", "conflict"]),
}).readonly();
export const SuggestionSchema = z.strictObject({
  id: IdSchema, scope: ScopeSchema, authorId: IdSchema, origin: z.enum(["human", "ai"]),
  edits: z.array(ProposedEditSchema).readonly(), createdAt: InstantSchema,
}).readonly();
export const CommentSchema = z.strictObject({
  id: IdSchema, authorId: IdSchema, body: z.string(), createdAt: InstantSchema,
  editedAt: InstantSchema.nullable(), version: CountSchema,
}).readonly();
export const ThreadSchema = z.strictObject({
  id: IdSchema, scope: ScopeSchema, anchor: AnchorSchema.nullable(), resolved: z.boolean(),
  comments: z.array(CommentSchema).readonly(),
}).readonly();
export const HistoryVersionSchema = z.strictObject({
  id: IdSchema, snapshot: SnapshotSchema, version: CountSchema,
  labels: z.array(z.strictObject({ id: IdSchema, name: z.string() }).readonly()).readonly(),
  authors: z.array(IdSchema).readonly(), reviewSnapshotId: IdSchema, accessible: z.boolean(),
}).readonly();
/** Applying actors of immutable file transitions, not original text authors. */
export const HistoryChangesSchema = z.strictObject({
  scope: ScopeSchema, fromVersionId: IdSchema, toVersionId: IdSchema,
  participants: z.array(z.strictObject({
    id: IdSchema, displayName: z.string().nullable(),
  }).readonly()).readonly(),
  changes: z.array(z.strictObject({
    id: z.string(), fromVersionId: IdSchema, toVersionId: IdSchema,
    fromRevision: CountSchema, toRevision: CountSchema,
    fileId: IdSchema, path: ProjectPathSchema,
    beforePath: ProjectPathSchema.nullable(), afterPath: ProjectPathSchema.nullable(),
    actorId: IdSchema, granularity: z.literal("recorded-file-transition"),
    reason: SnapshotSchema.unwrap().shape.reason, createdAt: InstantSchema,
    before: z.string().nullable(), after: z.string().nullable(),
  }).readonly()).readonly(),
}).readonly();
export const GitHunkSchema = z.strictObject({
  id: IdSchema, fileId: IdSchema, path: ProjectPathSchema, baseHead: GitOidSchema,
  baseRevision: CountSchema, oldStart: CountSchema, oldLines: CountSchema,
  newStart: CountSchema, newLines: CountSchema, before: z.string(), after: z.string(),
  staged: z.boolean(),
}).readonly();
export const GitStatusSchema = z.strictObject({
  head: GitOidSchema, branch: z.string(), upstream: z.string().nullable(), base: GitOidSchema,
  ahead: CountSchema, behind: CountSchema,
  files: z.array(z.strictObject({
    fileId: IdSchema, path: ProjectPathSchema,
    status: z.enum(["added", "modified", "deleted", "conflicted"]),
  }).readonly()).readonly(),
  hunks: z.array(GitHunkSchema).readonly(), staged: z.array(z.string()).readonly(),
}).readonly();
export const GitBranchSchema = z.strictObject({
  name: z.string(), head: GitOidSchema, current: z.boolean(),
  upstream: z.string().nullable(), base: GitOidSchema, ahead: CountSchema, behind: CountSchema,
}).readonly();
export const GitConflictFileSchema = z.strictObject({
  fileId: IdSchema, path: ProjectPathSchema, binary: z.boolean(),
  base: z.string().nullable(), ours: z.string().nullable(), theirs: z.string().nullable(),
  merged: z.string().nullable(),
}).readonly();
export const GitConflictSchema = z.strictObject({
  id: IdSchema, scope: ScopeSchema, from: z.string(), head: GitOidSchema,
  fromHead: GitOidSchema, base: GitOidSchema, version: CountSchema,
  files: z.array(GitConflictFileSchema).min(1).readonly(),
}).readonly();
export const GitComparisonSchema = z.strictObject({
  kind: z.enum(["working", "staged"]), base: SnapshotSchema, target: SnapshotSchema,
}).readonly();
export const TemplateVersionSchema = z.strictObject({
  id: IdSchema, templateId: IdSchema, snapshotId: IdSchema, name: z.string(), category: z.string(),
  description: z.string(), license: z.string(), visibility: z.enum(["public", "organization", "private"]),
  status: z.enum(["draft", "submitted", "approved", "published", "unpublished"]),
  organizationId: IdSchema.nullable(), version: CountSchema,
}).readonly();
export const TagSchema = z.strictObject({
  id: IdSchema, name: z.string(), colorHex: z.string().regex(/^#[a-fA-F0-9]{6}$/), version: CountSchema,
}).readonly();
export type CompileSettings = z.infer<typeof CompileSettingsSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
export type TextDocument = z.infer<typeof TextDocumentSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type ProposedEdit = z.infer<typeof ProposedEditSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type HistoryVersion = z.infer<typeof HistoryVersionSchema>;
export type HistoryChanges = z.infer<typeof HistoryChangesSchema>;
export type GitHunk = z.infer<typeof GitHunkSchema>;
export type GitStatus = z.infer<typeof GitStatusSchema>;
export type GitBranch = z.infer<typeof GitBranchSchema>;
export type GitConflictFile = z.infer<typeof GitConflictFileSchema>;
export type GitConflict = z.infer<typeof GitConflictSchema>;
export type GitComparison = z.infer<typeof GitComparisonSchema>;
export type TemplateVersion = z.infer<typeof TemplateVersionSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type Comment = z.infer<typeof CommentSchema>;
