import { z } from "zod";
import type { FileEntry } from "@quire/contracts";
import { fail } from "./store";

export const limits = z.object({
  uploadBytes: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  uploadEntries: z.coerce.number().int().positive().default(180),
  projectFiles: z.coerce.number().int().positive().default(2000),
  projectTextBytes: z.coerce.number().int().positive().default(7 * 1024 * 1024),
  editableBytes: z.coerce.number().int().positive().default(2 * 1024 * 1024),
}).parse({
  uploadBytes: Bun.env["QUIRE_UPLOAD_BYTES"], uploadEntries: Bun.env["QUIRE_UPLOAD_ENTRIES"],
  projectFiles: Bun.env["QUIRE_PROJECT_FILES"], projectTextBytes: Bun.env["QUIRE_PROJECT_TEXT_BYTES"],
  editableBytes: Bun.env["QUIRE_EDITABLE_BYTES"],
});
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.length > limits.editableBytes || bytes.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) { if (error instanceof TypeError) return null; throw error; }
}
export function checkFiles(files: readonly FileEntry[]): void {
  if (files.length > limits.projectFiles) fail("FILE_LIMIT", 413, "Project file count limit");
  if (files.reduce((sum, file) => sum + (file.editable ? file.bytes : 0), 0) > limits.projectTextBytes) {
    fail("TEXT_LIMIT", 413, "Project editable text limit");
  }
  const paths = new Map<string, FileEntry>();
  for (const file of files) {
    if (paths.has(file.path)) fail("PATH_CONFLICT", 409, `Duplicate path ${file.path}`);
    paths.set(file.path, file);
  }
  for (const file of files) {
    const parts = file.path.split("/");
    parts.pop();
    while (parts.length) {
      if (paths.get(parts.join("/"))?.kind === "file") fail("PATH_CONFLICT", 409, "A parent path is a file");
      parts.pop();
    }
  }
}
