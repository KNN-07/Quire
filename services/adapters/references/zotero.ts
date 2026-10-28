import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { PublicationSchema } from "@quire/contracts";
import type { Publication } from "@quire/contracts";
import { singleRecord, parseBibtex } from "../../core/catalog/bibtex";
import { DoiSchema } from "./publication";
import { nextLink, providerUrl } from "./transport";
import type { ProviderResponse, ReferenceTransport } from "./transport";

export const ZoteroSelectionSchema = z.strictObject({
  libraryType: z.enum(["users", "groups"]), libraryId: z.string().regex(/^\d+$/),
  collectionKey: z.string().regex(/^[A-Z0-9]{8}$/).optional(),
}).readonly();
export type ZoteroSelection = z.infer<typeof ZoteroSelectionSchema>;
const ItemSchema = z.object({
  key: z.string().min(1), version: z.number().int().nonnegative(), bibtex: z.string().optional(),
  data: z.object({
    itemType: z.string(), title: z.string().optional(), date: z.string().optional(), DOI: z.string().optional(), url: z.string().optional(),
    creators: z.array(z.object({ firstName: z.string().optional(), lastName: z.string().optional(), name: z.string().optional() })).default([]),
  }),
});
export type BibliographyResult = {
  readonly publications: readonly Publication[]; readonly responses: readonly ProviderResponse[]; readonly cursor: string;
  readonly pages: readonly { readonly publications: readonly Publication[]; readonly response: ProviderResponse }[];
};
export class Zotero {
  constructor(readonly transport: ReferenceTransport) {}
  async key(input: { readonly baseUrl: string; readonly apiKey: string; readonly signal: AbortSignal }) {
    const response = await this.transport.get(providerUrl(input.baseUrl, "keys/current"), {
      signal: input.signal, headers: { "Zotero-API-Version": "3", "Zotero-API-Key": input.apiKey },
    });
    return this.transport.json(response, z.object({ userID: z.number().int().positive(),
      access: z.object({ user: z.object({ library: z.boolean().optional() }).optional(),
        groups: z.record(z.string(), z.unknown()).optional() }) }));
  }
  async read(input: {
    readonly baseUrl: string; readonly apiKey: string; readonly selection: ZoteroSelection; readonly signal: AbortSignal;
  }): Promise<BibliographyResult> {
    const selected = input.selection;
    let url: URL | null = providerUrl(input.baseUrl, `${selected.libraryType}/${selected.libraryId}/${
      selected.collectionKey ? `collections/${selected.collectionKey}/items/top` : "items/top"}`);
    url.search = new URLSearchParams({ format: "json", include: "data,bibtex", limit: "100" }).toString();
    const responses: ProviderResponse[] = [];
    const retainedPages: BibliographyResult["pages"][number][] = [];
    const publications: Publication[] = [];
    const identifiers = new Set<string>();
    const pages = new Set<string>();
    let version: string | null = null;
    while (url) {
      if (pages.size >= 100 || pages.has(url.href)) throw new ServiceError("PROVIDER_PAGING_INVALID", 502, "Zotero pagination exceeded 100 pages or repeated");
      pages.add(url.href);
      const response = await this.transport.get(url, { signal: input.signal,
        headers: { "Zotero-API-Version": "3", "Zotero-API-Key": input.apiKey } });
      const current = z.string().regex(/^\d+$/).parse(response.headers.get("last-modified-version"));
      if (version !== null && current !== version) throw new ServiceError("PROVIDER_CHANGED", 409, "Zotero library changed during pagination; refresh again");
      version = current;
      responses.push(response);
      const pageStart = publications.length;
      for (const item of this.transport.json(response, z.array(ItemSchema))) {
        if (["attachment", "note", "annotation"].includes(item.data.itemType)) continue;
        if (identifiers.has(item.key)) throw new ServiceError("PROVIDER_DUPLICATE_ID", 409, "Zotero returned duplicate item IDs");
        identifiers.add(item.key);
        const record = singleRecord(z.string().min(1).parse(item.bibtex));
        const year = /\b(\d{4})\b/.exec(item.data.date ?? "")?.[1];
        publications.push(PublicationSchema.parse({
          provider: "zotero", providerId: `${selected.libraryType}/${selected.libraryId}/${item.key}`,
          title: item.data.title ?? record.citationKey,
          authors: item.data.creators.map(creator => creator.name ?? [creator.firstName, creator.lastName].filter(Boolean).join(" ")),
          year: year ? Number(year) : null, doi: item.data.DOI ? DoiSchema.parse(item.data.DOI) : null,
          url: item.data.url || null, bibtex: item.bibtex,
        }));
      }
      retainedPages.push({ publications: publications.slice(pageStart), response });
      url = nextLink(response);
    }
    if (publications.length) parseBibtex(publications.map(item => item.bibtex).join("\n"));
    return { publications, responses, pages: retainedPages, cursor: version ?? "0" };
  }
}
