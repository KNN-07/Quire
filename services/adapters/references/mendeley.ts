import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { publication, DoiSchema } from "./publication";
import { nextLink, providerUrl } from "./transport";
import type { ReferenceTransport } from "./transport";
import type { BibliographyResult } from "./zotero";
import type { RetrievalPage } from "./crossref";

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
  async page(input: {
    readonly baseUrl: string; readonly accessToken: string; readonly query: string | null;
    readonly cursor: string | null; readonly limit: number; readonly signal: AbortSignal;
  }): Promise<RetrievalPage> {
    const path = input.query === null ? "documents" : "search/catalog";
    const url = providerUrl(input.baseUrl, path);
    url.search = new URLSearchParams({ limit: String(input.limit), view: "bib",
      ...(input.query === null ? {} : { query: input.query }),
      ...(input.cursor === null ? {} : { marker: input.cursor }) }).toString();
    const response = await this.transport.get(url, { signal: input.signal,
      headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/vnd.mendeley-document.1+json" } });
    const next = nextLink(response);
    const cursor = next?.searchParams.get("marker") ?? null;
    if (next && !cursor) throw new ServiceError("PROVIDER_PAGING_INVALID", 502, "Mendeley next page lacks marker");
    return { publications: this.transport.json(response, z.array(DocumentSchema)).map(convert), nextCursor: cursor, response };
  }
  async read(input: { readonly baseUrl: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<BibliographyResult> {
    const responses: BibliographyResult["responses"][number][] = [];
    const pages: BibliographyResult["pages"][number][] = [];
    const publications: BibliographyResult["publications"][number][] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await this.page({ ...input, query: null, cursor, limit: 100 });
      responses.push(page.response);
      publications.push(...page.publications);
      pages.push(page);
      cursor = page.nextCursor;
      if (cursor && (cursors.has(cursor) || cursors.size >= 99)) {
        throw new ServiceError("PROVIDER_PAGING_INVALID", 502, "Mendeley pagination repeated or exceeded 100 pages");
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (new Set(publications.map(item => item.providerId)).size !== publications.length) {
      throw new ServiceError("PROVIDER_DUPLICATE_ID", 409, "Mendeley returned duplicate document IDs");
    }
    return { publications, responses, pages, cursor: new Bun.CryptoHasher("sha256")
      .update(responses.map(response => new TextDecoder().decode(response.bytes)).join("\n")).digest("hex") };
  }
}
