import { endpoints, LibraryEntrySchema, TemplateVersionSchema, FileEntrySchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { z } from "zod";
import { actor, etag, replay } from "../base/http";
import { Library } from "./library";
import { Templates } from "./templates";
import { transition } from "./publication";
import { cite } from "./citations";
import { fail, page, projects } from "./storage";

export { migrations } from "./migrations";
export { Library } from "./library";
export { Templates } from "./templates";
export { cite } from "./citations";
export { parseBibtex, singleRecord } from "./bibtex";

export function register(context: ModuleContext): void {
  const library = new Library(context);
  const templates = new Templates(context);
  const { register: route } = context.routes;
  route(endpoints.libraryList, async (input, request) => page((await library.list(await actor(context, request))), input.query));
  route(endpoints.libraryGet, async (input, request) => {
    const result = (await library.get(await actor(context, request), input.params.id));
    etag(request, result.version); return result;
  });
  route(endpoints.libraryCreate, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: "catalog:libraryCreate", body: input.body, schema: LibraryEntrySchema }, async receipt => {
      const result = (await library.create(actorId, input.body, receipt));
      etag(request, result.version); return result;
    });
  });
  route(endpoints.libraryPatch, async (input, request) => {
    const result = (await library.patch(await actor(context, request), { ...input.body, id: input.params.id }));
    etag(request, result.version); return result;
  });
  route(endpoints.libraryDelete, async (input, request) => {
    const result = (await library.delete(await actor(context, request), { ...input.body, id: input.params.id }));
    etag(request, result.version); return result;
  });
  route(endpoints.libraryImport, async (input, request) => {
    const actorId = await actor(context, request);
    const file = input.body.file;
    return replay(context, { actorId, request, route: "catalog:libraryImport",
      body: { name: file.name, digest: new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex") },
      schema: z.array(LibraryEntrySchema) }, async receipt => [...await library.import(actorId, file, receipt)]);
  });
  route(endpoints.citationCreate, async (input, request) => {
    const actorId = await actor(context, request);
    if (input.params.p !== input.body.scope.projectId) fail("SCOPE_MISMATCH", 400, "Route and source scope differ");
    await projects(context).authorize(actorId, input.body.scope, "files.write");
    return replay(context, { actorId, request, route: `catalog:cite:${input.params.p}`, body: input.body, schema: FileEntrySchema },
      async receipt => {
        const result = await cite(context, actorId, { ...input.body, http: receipt });
        etag(request, result.version.revision); return result;
      });
  });
  route(endpoints.templatesList, async (input, request) => {
    const principal = await context.services.get("identity").authenticate(request.request);
    return page((await templates.list(principal?.user.id ?? null)), input.query);
  });
  route(endpoints.adminTemplatesList, async (input, request) => {
    const principal = await context.services.get("identity").require(request.request);
    if (!principal.operator) fail("FORBIDDEN", 403, "Operator access required");
    return page((await templates.administration()), input.query);
  });
  route(endpoints.templateGet, async (input, request) => {
    const principal = await context.services.get("identity").authenticate(request.request);
    const result = (await templates.get(principal?.user.id ?? null, input.params.id));
    etag(request, result.version); return result;
  });
  route(endpoints.templateCreate, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: "catalog:templateCreate", body: input.body, schema: TemplateVersionSchema },
      async receipt => { const result = await templates.create(actorId, input.body, receipt); etag(request, result.version); return result; });
  });
  route(endpoints.templatePatch, async (input, request) => {
    const result = await templates.patch(await actor(context, request), { ...input.body, id: input.params.id });
    etag(request, result.version); return result;
  });
  route(endpoints.templateDelete, async (input, request) => {
    const result = (await templates.delete(await actor(context, request), { ...input.body, id: input.params.id }));
    etag(request, result.version); return result;
  });
  route(endpoints.templateVersion, async (input, request) => {
    const actorId = await actor(context, request);
    return replay(context, { actorId, request, route: `catalog:templateVersion:${input.params.id}`, body: input.body, schema: TemplateVersionSchema },
      async receipt => { const result = await templates.newVersion(actorId, { ...input.body, id: input.params.id }, receipt); etag(request, result.version); return result; });
  });
  route(endpoints.templateSubmit, async (input, request) => {
    const result = await transition(templates, await actor(context, request), { ...input.body, id: input.params.id, status: "submitted" });
    etag(request, result.version); return result;
  });
  route(endpoints.templateApprove, async (input, request) => {
    const result = await transition(templates, await actor(context, request), { ...input.body, id: input.params.id, status: "approved" });
    etag(request, result.version); return result;
  });
  route(endpoints.templatePublish, async (input, request) => {
    const result = await transition(templates, await actor(context, request), { ...input.body, id: input.params.id, status: "published" });
    etag(request, result.version); return result;
  });
  route(endpoints.templateUnpublish, async (input, request) => {
    const result = await transition(templates, await actor(context, request), { ...input.body, id: input.params.id, status: "unpublished" });
    etag(request, result.version); return result;
  });
}
