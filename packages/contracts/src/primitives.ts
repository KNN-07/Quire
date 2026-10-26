import { z } from "zod";

export const IdSchema = z.uuid().brand<"Id">();
export const InstantSchema = z.iso.datetime({ offset: false }).brand<"Instant">();
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"Digest">();
export const GitOidSchema = z.union([
  z.templateLiteral(["sha1:", z.string().regex(/^[a-f0-9]{40}$/)]),
  z.templateLiteral(["sha256:", z.string().regex(/^[a-f0-9]{64}$/)]),
]);
export const CountSchema = z.number().int().nonnegative();
export const Base64Schema = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const RoleSchema = z.enum(["owner", "editor", "reviewer", "viewer"]);
export const BranchSchema = z.string().min(1).max(255).refine(
  (value) => !value.startsWith("/") && !value.includes("..") && !/[\s~^:?*[\]\\]/u.test(value),
  "Invalid branch name",
);
export const ProjectPathSchema = z.string().min(1).max(4096).refine(
  (value) => !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".." &&
      part.toLowerCase() !== ".git" && !part.includes("\0")),
  "Expected normalized project-relative POSIX path",
);
export const ScopeSchema = z.strictObject({ projectId: IdSchema, branch: BranchSchema }).readonly();
export const VersionSchema = z.strictObject({ revision: CountSchema, epoch: CountSchema }).readonly();
export const JobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "timeout", "canceled"]);
export const CapabilitySchema = z.strictObject({
  enabled: z.boolean(),
  state: z.enum(["ready", "unconfigured", "disabled", "degraded", "experimental"]),
  reason: z.string().optional(),
}).readonly();
export const OkSchema = z.strictObject({ ok: z.literal(true), version: CountSchema }).readonly();
export const ErrorSchema = z.strictObject({
  code: z.string().min(1), message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
}).readonly();
export const ErrorResultSchema = z.strictObject({ error: ErrorSchema, requestId: IdSchema }).readonly();
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item).readonly(), nextCursor: z.string().nullable() }).readonly();
export const resultSchema = <T extends z.ZodType>(data: T) => z.union([
  z.strictObject({ data, requestId: IdSchema }).readonly(), ErrorResultSchema,
]);
export type Id = z.infer<typeof IdSchema>;
export type Instant = z.infer<typeof InstantSchema>;
export type Digest = z.infer<typeof DigestSchema>;
export type GitOid = z.infer<typeof GitOidSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type Version = z.infer<typeof VersionSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type Page<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };
export type Result<T> =
  | { readonly data: T; readonly requestId: Id }
  | { readonly error: z.infer<typeof ErrorSchema>; readonly requestId: Id };
export function assertNever(value: never): never {
  throw new TypeError(`Unexpected variant: ${String(value)}`);
}
