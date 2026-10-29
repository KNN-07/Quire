import { createHash } from "node:crypto";
import { z } from "zod";
import { DigestSchema, FileEntrySchema, IdSchema, ProjectPathSchema } from "@quire/contracts";

export const folderSelection = z.strictObject({ folderId: z.string().startsWith("id:").max(255) });
export const folderImport = folderSelection.extend({
  name: z.string().trim().min(1).max(255), mainPath: ProjectPathSchema,
});
export type FolderImport = z.infer<typeof folderImport>;
export const folderReservation = z.object({
  project_id: IdSchema, actor_id: IdSchema, parameters_json: z.string(), payload_json: z.string().nullable(),
});

export const remoteFile = z.object({
  ".tag": z.literal("file").default("file"), id: z.string().min(1),
  path_lower: z.string().startsWith("/"), path_display: z.string().startsWith("/"),
  rev: z.string().min(1), content_hash: DigestSchema, size: z.number().int().nonnegative(),
});
export type RemoteFile = z.infer<typeof remoteFile>;
export const remoteFolder = z.object({
  ".tag": z.literal("folder"), id: z.string().min(1),
  path_lower: z.string().startsWith("/"), path_display: z.string().startsWith("/"),
});
export type RemoteFolder = z.infer<typeof remoteFolder>;
export const remoteEntry = z.discriminatedUnion(".tag", [
  remoteFile,
  remoteFolder,
  z.object({ ".tag": z.literal("deleted"), path_lower: z.string(), path_display: z.string() }),
]);
export const baseline = z.object({
  fileId: IdSchema, path: z.string(), local: DigestSchema.nullable(), remote: remoteFile.nullable(),
});
export const conflict = z.object({
  kind: z.enum(["content", "rename", "delete", "main-delete", "recovery"]),
  path: z.string(), remotePath: z.string().nullable(), copyPath: z.string().nullable(),
});
export type Conflict = z.infer<typeof conflict>;
export const syncState = z.object({
  branch: z.string(), cursor: z.string().nullable(), generated: z.boolean(),
  files: z.array(baseline), remote: z.array(remoteFile), conflicts: z.array(conflict),
});
export type SyncState = z.infer<typeof syncState>;
export const localInput = z.object({ file: FileEntrySchema, blob: DigestSchema.optional() });
export const parameters = z.strictObject({
  branch: z.string().min(1).optional(), generatedOutput: z.boolean().default(false),
});
export type SyncParameters = z.infer<typeof parameters>;
export function contentHash(bytes: Uint8Array): string {
  const hash = createHash("sha256");
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) {
    hash.update(createHash("sha256").update(bytes.subarray(offset, offset + 4 * 1024 * 1024)).digest());
  }
  return hash.digest("hex");
}
export function headerJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
export function generatedPath(path: string): boolean {
  return path.toLowerCase().startsWith(".quire-generated/");
}
