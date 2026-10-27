import { FileEntrySchema } from "@quire/contracts";
import type { FileEntry, Id, Scope } from "@quire/contracts";
import type { CoreProjects } from "./projects";
import type { SourceInput } from "./source-records";
import type { RequestContext } from "@quire/runtime";
import { fail, compare, newId } from "./store";
import { limits } from "./limits";

export async function fileActor(service: CoreProjects, request: RequestContext, scope: Scope): Promise<Id> {
  const id = await service.authorizeRequest(request.request, scope, "files.write");
  if (!id) fail("UNAUTHENTICATED", 401, "Source edits require a signed-in editor");
  return id;
}
export async function mutateFiles(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly expectedVersion: number;
}, build: (files: readonly FileEntry[]) => Promise<readonly SourceInput[]>): Promise<readonly FileEntry[]> {
  return service.serialized(input.scope, async () => {
    await service.authorize(input.actorId, input.scope, "files.write");
    const branch = service.getBranch(input.scope);
    compare(branch.revision, input.expectedVersion);
    const inputs = await build(service.listFiles(input.scope));
    await service.commitSource({ ...input, expectedRevision: branch.revision, inputs });
    return service.listFiles(input.scope);
  });
}
export function emptyFile(path: string, kind: FileEntry["kind"]): FileEntry {
  return FileEntrySchema.parse({ id: newId(), path, kind, mime: kind === "folder" ? "inode/directory" : "text/plain",
    blob: null, bytes: 0, editable: false, version: { revision: 0, epoch: 0 }, link: null });
}
export async function uploadFiles(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly expectedVersion: number;
  readonly entries: readonly { readonly path: string; readonly bytes: Uint8Array }[];
}) {
  if (input.entries.length > limits.uploadEntries
    || input.entries.reduce((sum, entry) => sum + entry.bytes.length, 0) > limits.uploadBytes) {
    fail("UPLOAD_LIMIT", 413, "Upload exceeds expanded size or entry limit");
  }
  const ids = new Set<Id>();
  const result = await mutateFiles(service, input, async (files) => [
    ...files.map((file) => ({ file })),
    ...input.entries.map((entry) => {
      const file = emptyFile(entry.path, "file");
      ids.add(file.id);
      return { file, bytes: entry.bytes };
    }),
  ]);
  return result.filter((file) => ids.has(file.id));
}
export async function moveFile(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly fileId: Id; readonly path: string; readonly expectedVersion: number;
}) {
  await mutateFiles(service, input, async (files) => {
    const source = service.getFile(input.scope, input.fileId);
    if (input.path.startsWith(`${source.path}/`)) fail("PATH_CONFLICT", 409, "Cannot move folder into itself");
    return files.map((file) => ({
      file: file.id === source.id || (source.kind === "folder" && file.path.startsWith(`${source.path}/`))
        ? FileEntrySchema.parse({ ...file, path: input.path + file.path.slice(source.path.length) }) : file,
    }));
  });
  return service.getFile(input.scope, input.fileId);
}
export async function deleteFile(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly fileId: Id; readonly expectedVersion: number;
}) {
  await mutateFiles(service, input, async (files) => {
    const source = service.getFile(input.scope, input.fileId);
    return files.filter((file) => file.id !== source.id
      && !(source.kind === "folder" && file.path.startsWith(`${source.path}/`))).map((file) => ({ file }));
  });
  return { ok: true as const, version: service.getBranch(input.scope).revision };
}
