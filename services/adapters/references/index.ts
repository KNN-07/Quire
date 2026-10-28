import { endpoints, LibraryEntrySchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ServiceModule } from "@quire/runtime";
import type { ExternalLinks } from "../../core/base";
import { z } from "zod";
import type { AdapterContribution, AdapterServices } from "../shared";
import { actor, replay } from "../../core/base/http";
import { PublicationRetrieval, RetrievalProviderSchema } from "./retrieval";
import { BibliographySync } from "./bibliography";
import { ReferenceLibrary } from "./library-sync";
import { bibliographyDefinition, retrievalDefinition } from "./providers";
import { Zotero } from "./zotero";
import { DoiSchema } from "./publication";
import { ReferenceScheduler } from "./scheduler";
import { migrations } from "./migrations";
import { BibliographyLinks } from "./links";

export { PublicationRetrieval, RetrievalProviderSchema } from "./retrieval";
export type { SearchRequest, RetrievalProvider } from "./retrieval";
export { publication, DoiSchema, ProvenanceSchema } from "./publication";
export type { Provenance, RetrievedPublication, PublicationMetadata } from "./publication";
export { ReferenceLibrary } from "./library-sync";
export { ReferenceScheduler, periodicSyncTicker } from "./scheduler";
export type { SyncTicker } from "./scheduler";
export { migrations } from "./migrations";

/** Contributions join the shared assembly; the module owns only references routes and storage. */
export function createReferencesModules() {
  let services: AdapterServices | undefined;
  let retrieval: PublicationRetrieval | undefined;
  let bibliography: BibliographySync | undefined;
  let scheduler: ReferenceScheduler | undefined;
  const ensure = (input: AdapterServices) => {
    if (services && services !== input) throw new ServiceError("REFERENCES_ALREADY_BOUND", 500, "Create references factory per runtime");
    services = input;
    retrieval ??= new PublicationRetrieval(input);
    bibliography ??= new BibliographySync(input, retrieval);
    return { services: input, retrieval, bibliography };
  };
  const contributions: readonly AdapterContribution[] = [
    ...(["zotero", "mendeley", "readcube"] as const).map(kind => (input: AdapterServices) => {
      const state = ensure(input);
      const definition = bibliographyDefinition({ kind, ...state });
      if (kind === "zotero") scheduler = new ReferenceScheduler(input, definition);
      return definition;
    }),
    ...(["doi", "crossref", "arxiv", "semanticScholar", "dimensions"] as const).map(kind =>
      (input: AdapterServices) => retrievalDefinition(kind, ensure(input).retrieval)),
  ];
  function bound() {
    if (!services || !retrieval || !bibliography || !scheduler) {
      throw new ServiceError("REFERENCES_UNAVAILABLE", 503, "Register references contributions with shared adapters before references module");
    }
    return { services, retrieval, bibliography, scheduler };
  }
  async function connectZotero(actorId: Id, raw: { readonly apiKey: string; readonly label: string }) {
    const input = z.strictObject({ apiKey: z.string().min(1).max(512), label: z.string().min(1).max(200) }).parse(raw);
    const state = bound();
    const settings = await state.retrieval.configuration("zotero");
    await state.services.grants.activeActor(actorId, state.services.context.db);
    const key = await new Zotero(state.retrieval.transport).key({
      baseUrl: settings.baseUrl, apiKey: input.apiKey, signal: AbortSignal.timeout(15_000) });
    if (!key.access.user?.library && !Object.keys(key.access.groups ?? {}).length) {
      throw new ServiceError("PROVIDER_ACCESS_DENIED", 403, "Zotero key must permit personal or group library read access");
    }
    return state.services.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const current = await state.services.configuration.get("zotero", tx);
      if (current.version !== settings.version || !current.enabled) throw new ServiceError("PROVIDER_CHANGED", 409, "Zotero configuration changed");
      return state.services.grants.create({ actorId, provider: "zotero", label: input.label,
        tokens: { accessToken: input.apiKey, refreshToken: null, tokenType: "Bearer",
          scopes: ["library.read"], expiresAt: null } }, tx);
    });
  }
  const module: ServiceModule = {
    id: "064-x-references", lane: "X", order: 64, migrations,
    async register(context) {
      const state = bound();
      await state.bibliography.journal.recover();
      context.routes.register(endpoints.connectionCredentials, async (input, request) =>
        connectZotero(await actor(context, request), { apiKey: input.body.accessToken, label: input.body.label }));
      context.routes.register(endpoints.libraryDoi, async (input, request) => {
        const actorId = await actor(context, request);
        return replay(context, { actorId, request, route: "references:doi", body: input.body, schema: LibraryEntrySchema }, async receipt => {
          const item = await state.retrieval.lookup(actorId, DoiSchema.parse(input.body.doi), "doi");
          return new ReferenceLibrary(context).copy({ actorId, publication: item.publication, origin: "doi" }, receipt);
        });
      });
      context.routes.register(endpoints.referencesSearch, async (input, request) => {
        const actorId = await actor(context, request);
        if (input.query.fields && input.query.fields !== "title,authors,year,doi,url") {
          throw new ServiceError("REFERENCE_FIELDS_UNSUPPORTED", 422, "Supported fields: title,authors,year,doi,url");
        }
        if (input.query.provider === "readcube") throw new ServiceError("PROVIDER_UNCONFIGURED", 503,
          "Missing: ReadCube approved partner API search/authentication/response contract");
        const page = await state.retrieval.search({ actorId, projectId: input.query.projectId,
          provider: RetrievalProviderSchema.parse(input.query.provider), query: input.query.query,
          cursor: input.query.cursor, limit: input.query.limit });
        return { items: page.items.map(item => item.publication), nextCursor: page.nextCursor };
      });
    },
  };
  const links: ExternalLinks = {
    create(input) { const state = bound(); return new BibliographyLinks(state.services, state.bibliography).create(input); },
    refresh(input) { const state = bound(); return new BibliographyLinks(state.services, state.bibliography).refresh(input); },
  };
  return {
    contributions, module, links,
    get retrieval() { return bound().retrieval; },
    get scheduler() { return bound().scheduler; },
    connectZotero,
    async close() { await scheduler?.close(); },
  };
}
