import { z } from "zod";
import { endpoints, FileEntrySchema, IdSchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { actor, replay, etag } from "./http";
import { fail, newId } from "./store";
import { emptyFile, mutateFiles } from "./files";
import { externalLinks } from "./link-adapter";

export function registerLinkRoutes(context: ModuleContext, service: CoreProjects): void {
  context.routes.register(endpoints.linkCreate, async (input, request) => {
    const actorId = await actor(context, request);
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Path and body project differ");
    if (input.body.kind !== "project") {
      const kind = input.body.kind;
      await service.authorize(actorId, input.body.scope, "files.write");
      return replay(context, { actorId, request, route: `linkCreate:${input.params.p}`, body: input.body, schema: FileEntrySchema }, async http => {
        const file = await externalLinks(context).create({
          scope: input.body.scope, path: input.body.path, expectedVersion: input.body.expectedVersion,
          kind, actorId, ...(input.body.url ? { url: input.body.url } : {}),
          ...(input.body.grantId ? { grantId: input.body.grantId } : {}), ...(http ? { http } : {}),
        });
        etag(request, (await service.getBranch(input.body.scope)).revision);
        return file;
      });
    }
    const sourceId = input.body.sourceProjectId;
    const sourceFileId = input.body.sourceFileId;
    if (!sourceId || !sourceFileId) fail("INVALID_LINK", 400, "Source project and file are required");
    if (sourceId === input.params.p) fail("INVALID_LINK", 422, "Cross-project links need a different source project");
    return replay(context, { actorId, request, route: `linkCreate:${input.params.p}`, body: input.body, schema: FileEntrySchema }, async (http) => {
      const project = (await service.getProject(sourceId));
      const sourceScope = { projectId: project.id, branch: project.defaultBranch };
      await service.authorize(actorId, sourceScope, "read");
      const source = (await service.getFile(sourceScope, sourceFileId));
      if (source.kind !== "file" || !source.blob) fail("INVALID_LINK", 422, "Source must be a file");
      const id = newId();
      const file = FileEntrySchema.parse({
        ...emptyFile(input.body.path, "file"), id, blob: source.blob,
        bytes: source.bytes, mime: source.mime, link: {
          kind: "project", sourceId: `${sourceId}:${sourceFileId}`,
          lastRefreshedAt: context.clock.now()
        }
      });
      await mutateFiles(service, {
        actorId, scope: input.body.scope, expectedVersion: input.body.expectedVersion,
        ...(http ? { http: { ...http, result: { kind: "file", id } } } : {})
      },
        async (files) => [...files.map((entry) => ({ file: entry })), { file }]);
      const branch = (await service.getBranch(input.body.scope));
      etag(request, branch.revision); return (await service.getFile(input.body.scope, id));
    });
  });
  context.routes.register(endpoints.linkRefresh, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `linkRefresh:${input.params.p}:${input.params.id}`, body: input.body, schema: FileEntrySchema }, async (http) => {
      const project = (await service.getProject(input.params.p));
      const scope = { projectId: project.id, branch: project.defaultBranch };
      await service.authorize(actorId, scope, "files.write");
      const current = await service.getFile(scope, input.params.id);
      if (current.link && current.link.kind !== "project") {
        const file = await externalLinks(context).refresh({
          actorId, scope, fileId: current.id, ...input.body, ...(http ? { http } : {}),
        });
        etag(request, (await service.getBranch(scope)).revision);
        return file;
      }
      const row = (await service.one(`SELECT * FROM linked_files WHERE file_id=? AND branch_id=? AND kind='project'`,
        [input.params.id, (await service.getBranch(scope)).id], z.object({
          id: z.string(), source_project_id: IdSchema, source_file_id: IdSchema, version: z.number(),
        })));
      const sourceProject = (await service.getProject(row.source_project_id));
      const sourceScope = { projectId: sourceProject.id, branch: sourceProject.defaultBranch };
      await service.authorize(actorId, sourceScope, "read");
      const source = (await service.listFiles(sourceScope)).find((file) => file.id === row.source_file_id);
      if (!source || !source.blob) fail("SOURCE_MISSING", 409, "Linked source was deleted; child bytes remain unchanged");
      const old = (await service.getFile(scope, input.params.id));
      if (old.blob !== input.body.expectedDigest) fail("LINK_CONFLICT", 409, "Child digest changed");
      await mutateFiles(service, {
        actorId, scope, expectedVersion: input.body.expectedVersion,
        ...(http ? { http: { ...http, result: { kind: "file", id: old.id } } } : {})
      }, async (files) =>
      (await Promise.all(files.map(async (file) => ({
        file: file.id !== old.id ? file : FileEntrySchema.parse({
          ...file, blob: source.blob, bytes: source.bytes, mime: source.mime,
          version: { ...file.version, revision: (await service.getBranch(scope)).revision + 1 },
          link: { kind: "project", sourceId: `${sourceProject.id}:${source.id}`, lastRefreshedAt: context.clock.now() },
        })
      })))));
      etag(request, (await service.getBranch(scope)).revision); return (await service.getFile(scope, old.id));
    });
  });
}
