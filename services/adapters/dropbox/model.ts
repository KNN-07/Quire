import { createHash } from "node:crypto";
import { z } from "zod";
import { DigestSchema, FileEntrySchema, IdSchema } from "@quire/contracts";

export const remoteFile = z.object({
  ".tag": z.literal("file").default("file"), id: z.string().min(1),
  path_lower: z.string().startsWith("/"), path_display: z.string().startsWith("/"),
  rev: z.string().min(1), content_hash: DigestSchema, size: z.number().int().nonnegative(),
});
export type RemoteFile = z.infer<typeof remoteFile>;
export const remoteEntry = z.discriminatedUnion(".tag", [
  remoteFile,
  z.object({ ".tag": z.literal("folder"), path_lower: z.string(), path_display: z.string(), id: z.string() }),
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
