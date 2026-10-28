import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { publication, DoiSchema } from "./publication";
import { providerUrl } from "./transport";
import type { ReferenceTransport, ProviderResponse } from "./transport";
import type { Publication } from "@quire/contracts";

const WorkSchema = z.object({
  DOI: z.string().min(1), title: z.array(z.string()).min(1),
  author: z.array(z.object({ given: z.string().optional(), family: z.string().optional(),
    name: z.string().optional() })).default([]),
  issued: z.object({ "date-parts": z.array(z.array(z.number().int())) }).optional(),
  URL: z.url().optional(),
});
const SearchSchema = z.object({ message: z.object({
  items: z.array(WorkSchema), "next-cursor": z.string().optional(), "total-results": z.number().int().nonnegative(),
}) });
function convert(work: z.infer<typeof WorkSchema>): Publication {
  const doi = DoiSchema.parse(work.DOI);
  return publication({ provider: "crossref", providerId: doi, title: work.title.join(" "),
    authors: work.author.map(author => author.name ?? [author.given, author.family].filter(Boolean).join(" ")),
    year: work.issued?.["date-parts"][0]?.[0] ?? null, doi, url: work.URL ?? `https://doi.org/${doi}` });
}
export type RetrievalPage = {
  readonly publications: readonly Publication[]; readonly nextCursor: string | null; readonly response: ProviderResponse;
};
export class Crossref {
  constructor(readonly transport: ReferenceTransport) {}
  async lookup(input: { readonly baseUrl: string; readonly doi: string; readonly signal: AbortSignal }): Promise<RetrievalPage> {
    const url = providerUrl(input.baseUrl, `works/${encodeURIComponent(DoiSchema.parse(input.doi))}`);
    const response = await this.transport.get(url, { signal: input.signal, headers: { accept: "application/json" } });
    const work = this.transport.json(response, z.object({ message: WorkSchema })).message;
    if (DoiSchema.parse(work.DOI) !== DoiSchema.parse(input.doi)) {
      throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "Crossref returned another DOI");
    }
    return { publications: [convert(work)], nextCursor: null, response };
  }
  async search(input: {
    readonly baseUrl: string; readonly query: string; readonly cursor: string | null; readonly limit: number;
    readonly signal: AbortSignal;
  }): Promise<RetrievalPage> {
    const url = providerUrl(input.baseUrl, "works");
    url.search = new URLSearchParams({ "query.bibliographic": input.query, rows: String(input.limit), cursor: input.cursor ?? "*" }).toString();
    const response = await this.transport.get(url, { signal: input.signal, headers: { accept: "application/json" } });
    const message = this.transport.json(response, SearchSchema).message;
    return { publications: message.items.map(convert),
      nextCursor: message.items.length === input.limit ? message["next-cursor"] ?? null : null, response };
  }
}
