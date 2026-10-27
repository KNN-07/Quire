import { Unzip, UnzipInflate, zipSync } from "fflate";
import { ProjectPathSchema } from "@quire/contracts";
import type { Id, Snapshot } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { CoreProjects, NativeFile } from "./projects";
import { fail } from "./store";
import { limits } from "./limits";

/** Strict central-directory preflight precedes decompression and every database write. */
export function readZip(bytes: Uint8Array): readonly NativeFile[] {
  if (bytes.length > limits.uploadBytes || bytes.length < 22) fail("INVALID_ZIP", 422, "ZIP size is invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) fail("INVALID_ZIP", 422, "Missing ZIP directory");
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) fail("INVALID_ZIP", 422, "Multipart ZIP unsupported");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 65535 || offset + directorySize !== end || end + 22 + view.getUint16(end + 20, true) !== bytes.length) {
    fail("INVALID_ZIP", 422, "Malformed or ZIP64 archive");
  }
  if (count > limits.uploadEntries) fail("UPLOAD_LIMIT", 413, "Too many ZIP entries");
  let expanded = 0;
  const entries: { readonly name: string; readonly path: string; readonly folder: boolean; readonly size: number; readonly crc: number }[] = [];
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail("INVALID_ZIP", 422, "Invalid ZIP entry");
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    const mode = view.getUint32(offset + 38, true) >>> 16;
    const local = view.getUint32(offset + 42, true);
    if (offset + 46 + length + extra + comment > end || local + 30 > offset
      || view.getUint32(local, true) !== 0x04034b50 || flags & 1 || ![0, 8].includes(compression)
      || (mode & 0xf000 && ![0x8000, 0x4000].includes(mode & 0xf000))) {
      fail("INVALID_ZIP", 422, "Encrypted, special or malformed ZIP entry");
    }
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + length));
    const localLength = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const localName = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(local + 30, local + 30 + localLength));
    if (localName !== name || local + 30 + localLength + localExtra + view.getUint32(offset + 20, true) > view.getUint32(end + 16, true)) {
      fail("INVALID_ZIP", 422, "ZIP local entry does not match central directory");
    }
    const folder = name.endsWith("/");
    if (folder && size !== 0) fail("INVALID_ZIP", 422, "Directory entries cannot contain file data");
    const path = ProjectPathSchema.parse(folder ? name.slice(0, -1) : name);
    if (names.has(path)) fail("INVALID_ZIP", 422, "Duplicate ZIP path");
    names.add(path);
    expanded += size;
    if (expanded > limits.uploadBytes) fail("UPLOAD_LIMIT", 413, "ZIP expanded size exceeds quota");
    entries.push({ name, path, folder, size, crc: view.getUint32(offset + 16, true) });
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) fail("INVALID_ZIP", 422, "Unexpected ZIP directory data");
  const content = new Map<string, Uint8Array>();
  const expected = new Map(entries.map((entry) => [entry.name, entry]));
  const seen = new Set<string>();
  let actualExpanded = 0;
  const unzipper = new Unzip((file) => {
    const entry = expected.get(file.name);
    if (!entry || seen.has(file.name)) fail("INVALID_ZIP", 422, "ZIP local entries disagree with directory");
    seen.add(file.name);
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) fail("INVALID_ZIP", 422, error.message);
      size += chunk.length; actualExpanded += chunk.length;
      if (size > entry.size || actualExpanded > limits.uploadBytes) fail("UPLOAD_LIMIT", 413, "ZIP expanded bytes exceed declared size or quota");
      chunks.push(chunk);
      if (final) {
        const result = new Uint8Array(size);
        let cursor = 0;
        for (const part of chunks) { result.set(part, cursor); cursor += part.length; }
        content.set(file.name, result);
      }
    };
    file.start();
  });
  unzipper.register(UnzipInflate);
  try {
    for (let cursor = 0; cursor < bytes.length; cursor += 1024) {
      unzipper.push(bytes.subarray(cursor, cursor + 1024), cursor + 1024 >= bytes.length);
    }
  }
  catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error) fail("INVALID_ZIP", 422, `ZIP decompression failed: ${error.message}`);
    throw error;
  }
  return entries.map((entry) => {
    const data = content.get(entry.name);
    if (!data || data.length !== entry.size) fail("INVALID_ZIP", 422, "ZIP size mismatch");
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) fail("INVALID_ZIP", 422, "ZIP checksum mismatch");
    return { path: entry.path, bytes: data, folder: entry.folder };
  });
}
export async function importZip(service: CoreProjects, actorId: Id, input: {
  readonly name: string; readonly bytes: Uint8Array; readonly workspaceId?: Id;
}) {
  return service.createFromFiles(actorId, { name: input.name, entries: readZip(input.bytes),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) });
}
export async function sourceZip(service: CoreProjects, snapshot: Snapshot): Promise<Uint8Array> {
  const files = await service.readSnapshot(snapshot.id);
  const entries: Record<string, Uint8Array> = Object.create(null);
  for (const file of files.files) {
    entries[file.path + (file.kind === "folder" ? "/" : "")] = file.blob
      ? await service.context.blobs.get(file.blob) : new Uint8Array();
  }
  return zipSync(entries);
}
