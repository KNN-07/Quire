import { FileEntrySchema } from "@quire/contracts";
import type { FileEntry, Id, Scope } from "@quire/contracts";
import type { CoreProjects } from "./projects";
import type { SourceInput } from "./source-records";
import type { RequestContext } from "@quire/runtime";
import { fail, compare, newId } from "./store";
import { limits } from "./limits";
import type { HttpSourceReceipt, HttpReceipt } from "./receipts";

export async function fileActor(service: CoreProjects, request: RequestContext, scope: Scope): Promise<Id> {
  const id = await service.authorizeRequest(request.request, scope, "files.write");
  if (!id) fail("UNAUTHENTICATED", 401, "Source edits require a signed-in editor");
  return id;
}
export async function mutateFiles(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly expectedVersion: number;
  readonly http?: HttpSourceReceipt;
}, build: (files: readonly FileEntry[]) => Promise<readonly SourceInput[]>): Promise<readonly FileEntry[]> {
  return service.serialized(input.scope, async (lease) => {
    await service.authorize(input.actorId, input.scope, "files.write");
    const branch = (await service.getBranch(input.scope));
    compare(branch.revision, input.expectedVersion);
    const inputs = await build((await service.listFiles(input.scope)));
    await service.commitSource({ ...input, lease, expectedRevision: branch.revision, inputs });
    return (await service.listFiles(input.scope));
  });
}
export function emptyFile(path: string, kind: FileEntry["kind"]): FileEntry {
  return FileEntrySchema.parse({
    id: newId(), path, kind, mime: kind === "folder" ? "inode/directory" : "text/plain",
    blob: null, bytes: 0, editable: false, version: { revision: 0, epoch: 0 }, link: null
  });
}
export async function uploadFiles(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly expectedVersion: number;
  readonly entries: readonly { readonly path: string; readonly bytes: Uint8Array; readonly mime?: string }[];
  readonly http?: HttpReceipt;
}) {
  if (input.entries.length > limits.uploadEntries
    || input.entries.reduce((sum, entry) => sum + entry.bytes.length, 0) > limits.uploadBytes) {
    fail("UPLOAD_LIMIT", 413, "Upload exceeds expanded size or entry limit");
  }
  const added = input.entries.map(entry => ({
    file: { ...emptyFile(entry.path, "file"), ...(entry.mime ? { mime: entry.mime } : {}) }, bytes: entry.bytes,
  }));
  const ids = new Set(added.map(item => item.file.id));
  const result = await mutateFiles(service, {
    actorId: input.actorId, scope: input.scope, expectedVersion: input.expectedVersion,
    ...(input.http ? { http: { ...input.http, result: { kind: "files", ids: [...ids] } } } : {})
  }, async (files) => [
    ...files.map((file) => ({ file })),
    ...added,
  ]);
  return result.filter((file) => ids.has(file.id));
}
export async function moveFile(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly fileId: Id; readonly path: string; readonly expectedVersion: number;
}) {
  await mutateFiles(service, input, async (files) => {
    const source = (await service.getFile(input.scope, input.fileId));
    if (input.path.startsWith(`${source.path}/`)) fail("PATH_CONFLICT", 409, "Cannot move folder into itself");
    return files.map((file) => ({
      file: file.id === source.id || (source.kind === "folder" && file.path.startsWith(`${source.path}/`))
        ? FileEntrySchema.parse({ ...file, path: input.path + file.path.slice(source.path.length) }) : file,
    }));
  });
  return (await service.getFile(input.scope, input.fileId));
}
export async function deleteFile(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly fileId: Id; readonly expectedVersion: number;
}) {
  await mutateFiles(service, input, async (files) => {
    const source = (await service.getFile(input.scope, input.fileId));
    return files.filter((file) => file.id !== source.id
      && !(source.kind === "folder" && file.path.startsWith(`${source.path}/`))).map((file) => ({ file }));
  });
  return { ok: true as const, version: (await service.getBranch(input.scope)).revision };
}
