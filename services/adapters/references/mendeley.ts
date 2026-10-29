import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { publication, DoiSchema } from "./publication";
import { nextLink, providerUrl } from "./transport";
import type { ReferenceTransport } from "./transport";
import type { BibliographyResult } from "./zotero";
import type { RetrievalPage } from "./crossref";

export const MendeleySelectionSchema = z.discriminatedUnion("libraryType", [
  z.strictObject({ provider: z.literal("mendeley"), libraryType: z.literal("personal") }),
  z.strictObject({ provider: z.literal("mendeley"), libraryType: z.literal("groups"), groupId: z.uuid() }),
]).readonly();
export type MendeleySelection = z.infer<typeof MendeleySelectionSchema>;
const GroupSchema = z.object({
  id: z.uuid(), name: z.string().min(1), role: z.enum(["owner", "admin", "normal", "follower"]),
});
type Credentials = {
  readonly baseUrl: string; readonly accessToken: string; readonly signal: AbortSignal;
};
const DocumentSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), year: z.number().int().optional(),
  authors: z.array(z.object({ first_name: z.string().optional(), last_name: z.string().optional() })).default([]),
  identifiers: z.object({ doi: z.string().optional() }).optional(),
  websites: z.array(z.string()).optional(), link: z.url().optional(),
});
function convert(item: z.infer<typeof DocumentSchema>) {
  return publication({
    provider: "mendeley", providerId: item.id, title: item.title,
    authors: item.authors.map(author => [author.first_name, author.last_name].filter(Boolean).join(" ")),
    year: item.year ?? null, doi: item.identifiers?.doi ? DoiSchema.parse(item.identifiers.doi) : null,
    url: item.link ?? item.websites?.find(url => URL.canParse(url)) ?? null,
  });
}
export class Mendeley {
  constructor(readonly transport: ReferenceTransport) {}
  async groups(input: Credentials) {
    const groups: z.infer<typeof GroupSchema>[] = [];
    const seen = new Set<string>();
    let url: URL | null = providerUrl(input.baseUrl, "groups/v2");
    url.searchParams.set("limit", "100");
    while (url) {
      if (seen.has(url.href) || seen.size >= 100) {
        throw new ServiceError("PROVIDER_PAGING_INVALID", 502, "Mendeley group pagination repeated or exceeded 100 pages");
      }
      seen.add(url.href);
      const response = await this.transport.get(url, { signal: input.signal,
        headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/vnd.mendeley-group-list+json" } });
      groups.push(...this.transport.json(response, z.array(GroupSchema)));
      url = nextLink(response);
    }
    if (new Set(groups.map(group => group.id)).size !== groups.length) {
      throw new ServiceError("PROVIDER_DUPLICATE_ID", 409, "Mendeley returned duplicate group IDs");
    }
    return groups;
  }
  async page(input: {
    readonly baseUrl: string; readonly accessToken: string; readonly query: string | null;
    readonly cursor: string | null; readonly limit: number; readonly signal: AbortSignal;
    readonly selection?: MendeleySelection;
  }): Promise<RetrievalPage> {
    const path = input.query === null ? "documents" : "search/catalog";
    const url = providerUrl(input.baseUrl, path);
    url.search = new URLSearchParams({ limit: String(input.limit), view: "bib",
      ...(input.query === null ? {} : { query: input.query }),
      ...(input.query === null && input.selection?.libraryType === "groups" ? { group_id: input.selection.groupId } : {}),
      ...(input.cursor === null ? {} : { marker: input.cursor }) }).toString();
    const response = await this.transport.get(url, { signal: input.signal,
      headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/vnd.mendeley-document.1+json" } });
    const next = nextLink(response);
    const cursor = next?.searchParams.get("marker") ?? null;
    if (next && !cursor) throw new ServiceError("PROVIDER_PAGING_INVALID", 502, "Mendeley next page lacks marker");
    return { publications: this.transport.json(response, z.array(DocumentSchema)).map(convert), nextCursor: cursor, response };
  }
  async read(input: Credentials & { readonly selection?: MendeleySelection }): Promise<BibliographyResult> {
    if (input.selection?.libraryType === "groups") {
      const response = await this.transport.get(providerUrl(input.baseUrl, `groups/v2/${input.selection.groupId}`), {
        signal: input.signal,
        headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/vnd.mendeley-group+json" },
      });
      const group = this.transport.json(response, GroupSchema);
      if (group.id !== input.selection.groupId) {
        throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "Mendeley returned a different group");
      }
    }
    const responses: BibliographyResult["responses"][number][] = [];
    const pages: BibliographyResult["pages"][number][] = [];
    const publications: BibliographyResult["publications"][number][] = [];
    const visited = new Set<string>();
    let url: URL | null = providerUrl(input.baseUrl, "documents");
    url.search = new URLSearchParams({ limit: "100", view: "bib",
      ...(input.selection?.libraryType === "groups" ? { group_id: input.selection.groupId } : {}) }).toString();
    while (url) {
      if (visited.has(url.href) || visited.size >= 100) {
        throw new ServiceError("PROVIDER_PAGING_INVALID", 502, "Mendeley pagination repeated or exceeded 100 pages");
      }
      visited.add(url.href);
      const response = await this.transport.get(url, { signal: input.signal,
        headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/vnd.mendeley-document.1+json" } });
      const items = this.transport.json(response, z.array(DocumentSchema)).map(convert);
      responses.push(response);
      publications.push(...items);
      pages.push({ publications: items, response });
      const next = nextLink(response);
      if (next && next.searchParams.get("group_id") !== (input.selection?.libraryType === "groups" ? input.selection.groupId : null)) {
        throw new ServiceError("PROVIDER_PAGING_INVALID", 502, "Mendeley pagination changed the selected library");
      }
      url = next;
    }
    if (new Set(publications.map(item => item.providerId)).size !== publications.length) {
      throw new ServiceError("PROVIDER_DUPLICATE_ID", 409, "Mendeley returned duplicate document IDs");
    }
    return { publications, responses, pages, cursor: new Bun.CryptoHasher("sha256")
      .update(responses.map(response => new TextDecoder().decode(response.bytes)).join("\n")).digest("hex") };
  }
}
