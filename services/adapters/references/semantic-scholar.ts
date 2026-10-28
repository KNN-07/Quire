import { z } from "zod";
import { publication, DoiSchema } from "./publication";
import { providerUrl } from "./transport";
import type { ReferenceTransport } from "./transport";
import type { RetrievalPage } from "./crossref";

const PaperSchema = z.object({
  paperId: z.string().min(1), title: z.string().min(1), year: z.number().int().nullable(),
  authors: z.array(z.object({ name: z.string() })), url: z.url().nullable(),
  externalIds: z.object({ DOI: z.string().optional() }).nullable(),
});
export class SemanticScholar {
  constructor(readonly transport: ReferenceTransport) {}
  async search(input: {
    readonly baseUrl: string; readonly query: string; readonly cursor: string | null; readonly limit: number;
    readonly apiKey: string | null; readonly signal: AbortSignal;
  }): Promise<RetrievalPage> {
    const offset = z.coerce.number().int().min(0).max(999).parse(input.cursor ?? 0);
    const url = providerUrl(input.baseUrl, "paper/search");
    url.search = new URLSearchParams({ query: input.query, offset: String(offset), limit: String(Math.min(input.limit, 100)),
      fields: "title,authors,year,url,externalIds" }).toString();
    const response = await this.transport.get(url, { signal: input.signal,
      headers: { accept: "application/json", ...(input.apiKey ? { "x-api-key": input.apiKey } : {}) } });
    const page = this.transport.json(response, z.object({
      data: z.array(PaperSchema), next: z.number().int().nonnegative().optional(),
    }));
    return { publications: page.data.map(paper => publication({
      provider: "semanticScholar", providerId: paper.paperId, title: paper.title,
      authors: paper.authors.map(author => author.name), year: paper.year,
      doi: paper.externalIds?.DOI ? DoiSchema.parse(paper.externalIds.DOI) : null, url: paper.url,
    })), nextCursor: page.next === undefined || page.next >= 1000 ? null : String(page.next), response };
  }
}
