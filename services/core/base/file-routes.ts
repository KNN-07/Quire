import { z } from "zod";
import { endpoints, FileEntrySchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { etag, replay } from "./http";
import { fail } from "./store";
import { deleteFile, emptyFile, moveFile, mutateFiles, uploadFiles, fileActor } from "./files";
import { searchProject } from "./search";
import { registerLinkRoutes } from "./links";

export function registerFileRoutes(context: ModuleContext, service: CoreProjects): void {
  const { register } = context.routes;
  register(endpoints.filesList, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    await service.authorizeRequest(request.request, scope, "read");
    etag(request, service.getBranch(scope).revision); return [...service.listFiles(scope)];
  });
  register(endpoints.fileContent, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    await service.authorizeRequest(request.request, scope, "download");
    const file = service.getFile(scope, input.params.f);
    if (!file.blob) fail("NO_CONTENT", 422, "Folder has no content");
    request.responseHeaders.set("content-type", file.mime);
    request.responseHeaders.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split("/").at(-1) ?? "file")}`);
    return new Uint8Array(await context.blobs.get(file.blob));
  });
  register(endpoints.fileDocument, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    await service.authorizeRequest(request.request, scope, "read");
    const doc = service.readDocument(scope, input.params.f); etag(request, doc.file.version.revision); return doc;
  });
  register(endpoints.fileCreate, async (input, request) => {
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Path and body project differ");
    const actorId = await fileActor(service, request, input.body.scope);
    return replay(context, { actorId, request, route: `fileCreate:${input.params.p}`, body: input.body, schema: FileEntrySchema }, async () => {
      const file = emptyFile(input.body.path, input.body.kind);
      await mutateFiles(service, { actorId, ...input.body }, async (files) => [
        ...files.map((entry) => ({ file: entry })),
        { file, ...(file.kind === "file" ? { bytes: new TextEncoder().encode(input.body.text ?? "") } : {}) },
      ]);
      const result = service.getFile(input.body.scope, file.id); etag(request, service.getBranch(input.body.scope).revision); return result;
    });
  });
  register(endpoints.filePatch, async (input, request) => {
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Path and body project differ");
    const result = await moveFile(service, { actorId: await fileActor(service, request, input.body.scope), ...input.body, fileId: input.params.f });
    etag(request, service.getBranch(input.body.scope).revision); return result;
  });
  register(endpoints.fileDelete, async (input, request) => {
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Path and body project differ");
    const result = await deleteFile(service, { actorId: await fileActor(service, request, input.body.scope), ...input.body, fileId: input.params.f });
    etag(request, result.version); return result;
  });
  register(endpoints.filesUpload, async (input, request) => {
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Path and body project differ");
    const actorId = await fileActor(service, request, input.body.scope);
    const entries = await Promise.all(input.body.paths.map(async (path, index) => {
      const file = input.body.files[index];
      if (!file) fail("INVALID_UPLOAD", 400, "Missing file");
      return { path, bytes: new Uint8Array(await file.arrayBuffer()) };
    }));
    const body = { scope: input.body.scope, expectedVersion: input.body.expectedVersion,
      entries: entries.map((entry) => ({ path: entry.path, digest: new Bun.CryptoHasher("sha256").update(entry.bytes).digest("hex") })) };
    return replay(context, { actorId, request, route: `filesUpload:${input.params.p}`, body, schema: z.array(FileEntrySchema) }, async () => {
      const result = await uploadFiles(service, { actorId, scope: input.body.scope, expectedVersion: input.body.expectedVersion, entries });
      etag(request, service.getBranch(input.body.scope).revision); return [...result];
    });
  });
  register(endpoints.projectSearch, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    await service.authorizeRequest(request.request, scope, "read");
    return searchProject(service, scope, input.query);
  });
  registerLinkRoutes(context, service);
}
