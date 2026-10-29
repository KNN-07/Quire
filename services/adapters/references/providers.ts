import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { defineAction } from "../shared";
import type { AdapterDefinition, AdapterServices, ProviderSettings } from "../shared";
import { ZoteroSelectionSchema, Zotero } from "./zotero";
import { Mendeley } from "./mendeley";
import { ReferenceLibrary } from "./library-sync";
import { BulkSchema, RefreshSchema } from "./bibliography";
import type { BibliographySync } from "./bibliography";
import type { PublicationRetrieval } from "./retrieval";
import { RetrievalProviderSchema } from "./retrieval";
import { DoiSchema } from "./publication";
import { Crossref } from "./crossref";
import { Arxiv } from "./arxiv";
import { SemanticScholar } from "./semantic-scholar";
import { providerUrl } from "./transport";

export const readCubePrerequisites = [
  "ReadCube approved partner/developer API access agreement",
  "ReadCube contract specifying search, library export/paging and refresh endpoints and response schemas",
  "ReadCube account-scoped authentication and revocation contract",
] as const;
export const dimensionsPrerequisites = [
  "Dimensions institutional Analytics/CRIS API license permitting citation retrieval",
  "Dimensions tenant endpoint and licensed authentication/response contract",
  "Dimensions API credential",
] as const;
function basic(settings: ProviderSettings): readonly string[] { return settings.baseUrl ? [] : ["provider base URL"]; }
export function bibliographyDefinition(input: {
  readonly kind: "zotero" | "mendeley" | "readcube"; readonly services: AdapterServices;
  readonly bibliography: BibliographySync; readonly retrieval: PublicationRetrieval;
}): AdapterDefinition {
  const { kind, services, bibliography, retrieval } = input;
  const library = new ReferenceLibrary(services.context);
  const definition: AdapterDefinition = {
    kind, label: kind === "zotero" ? "Zotero" : kind === "mendeley" ? "Mendeley" : "ReadCube",
    configuration(settings) {
      switch (kind) {
        case "zotero": return basic(settings);
        case "mendeley": return [...basic(settings), ...(!settings.model ? ["Mendeley registered application client ID (model)"] : []),
          ...(!settings.secret ? ["Mendeley registered application client secret"] : [])];
        case "readcube": return readCubePrerequisites;
        default: { const unreachable: never = kind; throw new TypeError(String(unreachable)); }
      }
    },
    ...(kind === "mendeley" ? { oauth: (settings: ProviderSettings) => ({
      authorizationUrl: "https://api.mendeley.com/oauth/authorize", tokenUrl: "https://api.mendeley.com/oauth/token",
      clientId: z.string().min(1).parse(settings.model), clientSecret: z.string().min(1).parse(settings.secret),
      scopes: ["all"], tokenAuthentication: "basic" as const,
    }) } : {}),
    ...(kind === "zotero" ? { async revoke(context) {
      try {
        await new Zotero(retrieval.transport).key({ baseUrl: context.configuration.baseUrl,
          apiKey: context.tokens.accessToken, signal: context.signal });
      } catch (error) {
        if (error instanceof ServiceError && ["PROVIDER_AUTH_REQUIRED", "PUBLICATION_NOT_FOUND"].includes(error.code)) return;
        throw error;
      }
      throw new ServiceError("ZOTERO_MANUAL_REVOCATION_REQUIRED", 409,
        "Revoke the dedicated key in Zotero account API-key settings, then disconnect again; Quire never deletes a user-created key");
    } } satisfies Partial<AdapterDefinition> : {}),
    actions: {
      ...(kind === "mendeley" ? {
        groups: defineAction(z.strictObject({}), { projectAccess: "read",
          async prepare(_parameters, context) {
            const groups = await new Mendeley(retrieval.transport).groups({
              baseUrl: context.configuration.baseUrl, accessToken: context.tokens.accessToken, signal: context.signal });
            return { cursor: null, result: {
              personalUrl: providerUrl(context.configuration.baseUrl, "documents").href,
              groups: groups.map(group => ({ ...group,
                url: providerUrl(context.configuration.baseUrl, `groups/v2/${group.id}`).href })),
            } };
          },
        }),
      } : {}),
      bulkBib: defineAction(BulkSchema, { projectAccess: "owner", prepare: (parameters, context) => bibliography.bulk(parameters, context) }),
      refresh: defineAction(RefreshSchema, { projectAccess: "owner", prepare: (parameters, context) => bibliography.refresh(parameters, context) }),
      ...(kind === "zotero" ? { librarySync: defineAction(z.strictObject({ selection: ZoteroSelectionSchema }), {
        projectAccess: "none",
        async prepare(parameters, context) {
          const result = await bibliography.read(context, parameters.selection);
          return { result: { count: result.publications.length, selection: parameters.selection }, cursor: result.cursor,
            publish: tx => library.sync(tx, { actorId: context.actorId, grantId: context.grant.id,
              selection: JSON.stringify(parameters.selection), publications: result.publications }) };
        },
      }) } : {
        search: defineAction(z.strictObject({ query: z.string().min(1), cursor: z.string().nullable().default(null),
          limit: z.number().int().min(1).max(100).default(50) }), {
          projectAccess: "none",
          async prepare(parameters, context) {
            if (kind === "readcube") throw new ServiceError("PROVIDER_UNCONFIGURED", 503, `Missing: ${readCubePrerequisites.join("; ")}`);
            const page = await new Mendeley(retrieval.transport).page({ ...parameters,
              baseUrl: context.configuration.baseUrl, accessToken: context.tokens.accessToken, signal: context.signal });
            await retrieval.retain(context.actorId, page);
            return { result: { items: page.publications, nextCursor: page.nextCursor }, cursor: page.nextCursor };
          },
        }),
      }),
    },
    async test(context) {
      if (kind === "readcube") return { ok: false, reason: `Missing: ${readCubePrerequisites.join("; ")}` };
      if (kind === "zotero") {
        await new Zotero(retrieval.transport).key({ baseUrl: context.configuration.baseUrl,
          apiKey: context.tokens.accessToken, signal: context.signal });
      } else await new Mendeley(retrieval.transport).page({ baseUrl: context.configuration.baseUrl,
        accessToken: context.tokens.accessToken, query: null, cursor: null, limit: 1, signal: context.signal });
      return { ok: true };
    },
  };
  return definition;
}
export function retrievalDefinition(kind: "doi" | "crossref" | "arxiv" | "semanticScholar" | "dimensions",
  retrieval: PublicationRetrieval): AdapterDefinition {
  const probe = async (settings: ProviderSettings) => {
    const input = { baseUrl: settings.baseUrl, query: "quire", cursor: null, limit: 1, signal: AbortSignal.timeout(15_000) };
    switch (kind) {
      case "doi":
      case "crossref": await new Crossref(retrieval.transport).search(input); break;
      case "arxiv": await new Arxiv(retrieval.transport).search(input); break;
      case "semanticScholar": await new SemanticScholar(retrieval.transport).search({ ...input, apiKey: settings.secret }); break;
      case "dimensions": return { ok: false, reason: `Missing: ${dimensionsPrerequisites.join("; ")}` };
      default: { const unreachable: never = kind; throw new TypeError(String(unreachable)); }
    }
    return { ok: true };
  };
  return {
    kind, label: kind, configuration: settings => kind === "dimensions" ? dimensionsPrerequisites : basic(settings),
    probe,
    actions: kind === "doi" ? {
      lookup: defineAction(z.strictObject({ doi: DoiSchema }), { projectAccess: "none",
        async prepare(parameters, context) {
          const item = await retrieval.lookup(context.actorId, parameters.doi, "doi");
          return { result: { publication: item.publication, provenance: item.provenance }, cursor: item.provenance.responseDigest };
        } }),
    } : {
      search: defineAction(z.strictObject({ query: z.string().min(1), limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().nullable().default(null) }), { projectAccess: "read",
        async prepare(parameters, context) {
          if (!context.projectId) throw new ServiceError("PROJECT_REQUIRED", 400, "Retrieval requires project access");
          const page = await retrieval.search({ ...parameters, actorId: context.actorId,
            projectId: context.projectId, provider: RetrievalProviderSchema.parse(kind), signal: context.signal });
          return { result: { items: page.items, nextCursor: page.nextCursor }, cursor: page.nextCursor };
        } }),
    },
    test: context => probe(context.configuration),
  };
}
