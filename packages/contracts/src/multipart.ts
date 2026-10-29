import { z } from "zod";
import { ScopeSchema, ProjectPathSchema, IdSchema, DigestSchema, InstantSchema, CountSchema } from "./primitives";
import { EngineSchema } from "./projects";

export const ImportSelectionSchema = z.strictObject({
  mainPath: ProjectPathSchema.optional(), engine: EngineSchema.optional(), environmentId: IdSchema.optional(),
  preserveHistory: z.boolean().optional(), keepConnected: z.boolean().optional(),
}).readonly();
export const ImportUploadSchema = z.strictObject({
  id: IdSchema, filename: z.string().min(1).max(255), mime: z.string(),
  bytes: CountSchema, sha256: DigestSchema, expiresAt: InstantSchema,
}).readonly();

const jsonField = z.string().transform((text, context): unknown => {
  try { return JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    context.addIssue({ code: "custom", message: "Expected a JSON form field" });
    return z.NEVER;
  }
});
function formWith(fields: readonly string[]) {
  return z.instanceof(FormData).superRefine((form, context) => {
    for (const name of form.keys()) {
      if (!fields.includes(name)) context.addIssue({ code: "custom", message: `Unexpected form field: ${name}` });
      if (name !== "files" && form.getAll(name).length > 1) context.addIssue({ code: "custom", message: `Duplicate form field: ${name}` });
    }
  });
}
const formVersion = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative());
export const ImportSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("upload"), uploadId: IdSchema }),
  z.strictObject({ kind: z.literal("snippet"), text: z.string() }),
  z.strictObject({ kind: z.literal("data-url"), dataUrl: z.string().startsWith("data:") }),
  z.strictObject({ kind: z.literal("url"), url: z.url() }),
  z.strictObject({ kind: z.literal("git"), url: z.string(), branch: z.string(), grantId: IdSchema.optional() }),
]);
export const FilesUploadSchema = formWith(["scope", "paths", "files", "expectedVersion"]).transform((form) => ({
  scope: form.get("scope"), paths: form.get("paths"), files: form.getAll("files"),
  expectedVersion: form.get("expectedVersion"),
})).pipe(z.strictObject({
  scope: jsonField.pipe(ScopeSchema), paths: jsonField.pipe(z.array(ProjectPathSchema).min(1)),
  files: z.array(z.instanceof(File)).min(1), expectedVersion: formVersion,
})).superRefine((upload, context) => {
  if (upload.paths.length !== upload.files.length) context.addIssue({ code: "custom", message: "One path is required per file" });
  if (new Set(upload.paths).size !== upload.paths.length) context.addIssue({ code: "custom", message: "Duplicate paths" });
}).readonly();
export const AvatarUploadSchema = formWith(["file", "expectedVersion"]).transform((form) => ({
  file: form.get("file"), expectedVersion: form.get("expectedVersion"),
})).pipe(z.strictObject({
  file: z.instanceof(File), expectedVersion: formVersion,
})).readonly();
export const LibraryUploadSchema = formWith(["file"]).transform((form) => ({
  file: form.get("file"),
})).pipe(z.strictObject({ file: z.instanceof(File) })).readonly();
export const ImportUploadFormSchema = formWith(["file"]).transform(form => ({
  file: form.get("file"),
})).pipe(z.strictObject({ file: z.instanceof(File) })).readonly();
export const SamlCallbackSchema = formWith(["SAMLResponse", "RelayState"]).transform((form): {
  readonly SAMLResponse: FormDataEntryValue | null; readonly RelayState?: FormDataEntryValue | undefined;
} => {
  const relayState = form.get("RelayState");
  return { SAMLResponse: form.get("SAMLResponse"), ...(relayState === null ? {} : { RelayState: relayState }) };
}).pipe(z.strictObject({ SAMLResponse: z.string().min(1), RelayState: z.string().optional() })).readonly();
export const ImportFormSchema = formWith(["kind", "name", "workspaceId", "source", "mainPath", "engine", "environmentId", "preserveHistory", "keepConnected"]).transform((form): {
  readonly kind: FormDataEntryValue | null; readonly name: FormDataEntryValue | null;
  readonly source: FormDataEntryValue | null; readonly workspaceId?: FormDataEntryValue | undefined;
  readonly mainPath?: FormDataEntryValue | undefined; readonly engine?: FormDataEntryValue | undefined;
  readonly environmentId?: FormDataEntryValue | undefined;
  readonly preserveHistory?: FormDataEntryValue | undefined; readonly keepConnected?: FormDataEntryValue | undefined;
} => {
  return { kind: form.get("kind"), name: form.get("name"), source: form.get("source"),
    ...Object.fromEntries(["workspaceId", "mainPath", "engine", "environmentId", "preserveHistory", "keepConnected"].flatMap(name => {
      const value = form.get(name);
      return value === null ? [] : [[name, value]];
    })) };
}).pipe(z.strictObject({
  kind: z.enum(["zip", "docx", "markdown", "git", "github", "open-in"]),
  name: z.string().min(1), workspaceId: IdSchema.optional(),
  source: z.union([z.instanceof(File), jsonField.pipe(ImportSourceSchema)]),
  ...ImportSelectionSchema.unwrap().shape,
  preserveHistory: z.enum(["true", "false"]).transform(value => value === "true").optional(),
  keepConnected: z.enum(["true", "false"]).transform(value => value === "true").optional(),
})).readonly();
