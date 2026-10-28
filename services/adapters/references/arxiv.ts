import { DOMParser, ParseError } from "@xmldom/xmldom";
import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { publication, DoiSchema } from "./publication";
import { providerUrl } from "./transport";
import type { ReferenceTransport } from "./transport";
import type { RetrievalPage } from "./crossref";

const atom = "http://www.w3.org/2005/Atom";
export class Arxiv {
  private static readonly ready = new WeakMap<ReferenceTransport, number>();
  constructor(readonly transport: ReferenceTransport) {}
  async search(input: {
    readonly baseUrl: string; readonly query: string; readonly cursor: string | null; readonly limit: number;
    readonly signal: AbortSignal;
  }): Promise<RetrievalPage> {
    const now = Date.parse(this.transport.clock.now());
    if (now < (Arxiv.ready.get(this.transport) ?? 0)) throw new ServiceError("PROVIDER_RATE_LIMITED", 429, "arXiv requires at least three seconds between requests");
    Arxiv.ready.set(this.transport, now + 3000);
    const start = z.coerce.number().int().min(0).max(30_000).parse(input.cursor ?? 0);
    const url = providerUrl(input.baseUrl, "query");
    url.search = new URLSearchParams({ search_query: input.query, start: String(start), max_results: String(input.limit) }).toString();
    const response = await this.transport.get(url, { signal: input.signal });
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "arXiv XML declarations are forbidden");
    let document: ReturnType<DOMParser["parseFromString"]>;
    try {
      document = new DOMParser({ onError: () => {
        throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "Malformed arXiv Atom response");
      } }).parseFromString(xml, "text/xml");
    } catch (error) {
      if (error instanceof ParseError) throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "Malformed arXiv Atom response");
      throw error;
    }
    if (document.documentElement?.namespaceURI !== atom || document.documentElement.localName !== "feed") {
      throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "Expected an arXiv Atom feed");
    }
    const entries = Array.from(document.getElementsByTagNameNS(atom, "entry"));
    const publications = entries.map(entry => {
      const text = (name: string) => entry.getElementsByTagNameNS(atom, name).item(0)?.textContent?.trim() ?? "";
      const id = z.url().parse(text("id"));
      if (new URL(id).pathname.startsWith("/api/errors")) throw new ServiceError("PROVIDER_QUERY_INVALID", 422, text("summary"));
      const doi = entry.getElementsByTagNameNS("http://arxiv.org/schemas/atom", "doi").item(0)?.textContent;
      return publication({
        provider: "arxiv", providerId: id.split("/abs/")[1] ?? id, title: z.string().min(1).parse(text("title")).replace(/\s+/g, " "),
        authors: Array.from(entry.getElementsByTagNameNS(atom, "author")).map(author =>
          z.string().min(1).parse(author.getElementsByTagNameNS(atom, "name").item(0)?.textContent)),
        year: z.coerce.number().int().parse(text("published").slice(0, 4)), doi: doi ? DoiSchema.parse(doi) : null, url: id,
      });
    });
    const total = Number(document.getElementsByTagNameNS("http://a9.com/-/spec/opensearch/1.1/", "totalResults").item(0)?.textContent ?? NaN);
    if (!Number.isSafeInteger(total) || total < 0) throw new ServiceError("PROVIDER_RESPONSE_INVALID", 502, "Missing arXiv result count");
    return { publications, nextCursor: start + publications.length < total && publications.length ? String(start + publications.length) : null, response };
  }
}
