import { z } from "zod";
import { IdSchema, DigestSchema } from "@quire/contracts";

export const zoteroKey = "quire-fixture-zotero-read-key";
export const mendeleyToken = "quire-fixture-mendeley-read-token";
export function referenceProvider() {
  const state: {
    version: number; pages: number; status: number; retryAfter: string; malformed: boolean; repeatPage: boolean;
    pageVersionChanged: boolean; duplicateKey: boolean; duplicateId: boolean; title: string;
    requests: { readonly path: string; readonly headers: Headers }[];
    onRequest: (() => Promise<void>) | undefined;
  } = {
    version: 7, pages: 2, status: 200, retryAfter: "5", malformed: false, repeatPage: false,
    pageVersionChanged: false, duplicateKey: false, duplicateId: false, title: "Protocol paper",
    requests: [], onRequest: undefined,
  };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      state.requests.push({ path: url.pathname + url.search, headers: request.headers });
      if (state.onRequest) { const callback = state.onRequest; state.onRequest = undefined; await callback(); }
      if (state.status !== 200) return new Response("provider failure", { status: state.status, headers: { "retry-after": state.retryAfter } });
      if (state.malformed) return new Response("invalid provider payload");
      if (url.pathname === "/source.bib") {
        return new Response(`@misc{url_source,title={${state.title}}}\n`, { headers: { "content-type": "application/x-bibtex" } });
      }
      if (url.pathname === "/keys/current") {
        if (request.headers.get("zotero-api-key") !== zoteroKey) return new Response(null, { status: 401 });
        return Response.json({ userID: 123, access: { user: { library: true } } });
      }
      if (url.pathname.includes("/items")) {
        if (request.headers.get("zotero-api-key") !== zoteroKey || request.headers.get("zotero-api-version") !== "3") return new Response(null, { status: 403 });
        const start = Number(url.searchParams.get("start") ?? 0);
        const key = state.duplicateKey ? "stable_key" : `stable_key_${start}`;
        const items = [{ key: state.duplicateId ? "ITEM0000" : `ITEM000${start}`, version: state.version,
          data: { itemType: "journalArticle", title: state.title, date: "2026-10-27", DOI: `10.1234/zotero${start}`,
            creators: [{ firstName: "Ada", lastName: "Lovelace" }] },
          bibtex: `@article{${key},\n title = {${state.title}},\n year = {2026}\n}` }];
        const next = new URL(url);
        next.searchParams.set("start", String(state.repeatPage ? start : start + 1));
        return Response.json(items, { headers: { "last-modified-version": String(state.version + (state.pageVersionChanged && start > 0 ? 1 : 0)),
          ...(start + 1 < state.pages || state.repeatPage ? { link: `<${next.href}>; rel="next"` } : {}) } });
      }
      if (url.pathname === "/works" || url.pathname.startsWith("/works/")) {
        const work = { DOI: "10.1234/protocol", title: [state.title],
          author: [{ given: "Grace", family: "Hopper" }], issued: { "date-parts": [[2026, 10, 27]] }, URL: "https://doi.org/10.1234/protocol" };
        return Response.json({ message: url.pathname === "/works" ? { items: [work], "next-cursor": "page-two", "total-results": 2 } : work });
      }
      if (url.pathname === "/paper/search") {
        return Response.json({ data: [{ paperId: "semantic-paper-1", title: state.title, year: 2026,
          authors: [{ name: "Katherine Johnson" }], externalIds: { DOI: "10.1234/semantic" }, url: "https://www.semanticscholar.org/paper/semantic-paper-1" }],
        ...(url.searchParams.get("offset") === "1" ? {} : { next: 1 }) });
      }
      if (url.pathname === "/query") {
        return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"
          xmlns:open="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
          <open:totalResults>1</open:totalResults><entry><id>https://arxiv.org/abs/2610.12345v1</id>
          <title>${state.title}</title><published>2026-10-27T00:00:00Z</published><author><name>Emmy Noether</name></author>
          <arxiv:doi>10.1234/arxiv</arxiv:doi></entry></feed>`, { headers: { "content-type": "application/atom+xml" } });
      }
      if (url.pathname === "/documents" || url.pathname === "/search/catalog") {
        if (request.headers.get("authorization") !== `Bearer ${mendeleyToken}` ||
          request.headers.get("accept") !== "application/vnd.mendeley-document.1+json") return new Response(null, { status: 401 });
        const marker = url.searchParams.get("marker");
        const next = new URL(url); next.searchParams.set("marker", state.repeatPage ? "next" : "last");
        const items = [{ id: marker ? "mendeley-2" : "mendeley-1", title: state.title, year: 2025,
          authors: [{ first_name: "Alan", last_name: "Turing" }], identifiers: { doi: "10.1234/mendeley" } }];
        return Response.json(items, { headers: marker && !state.repeatPage ? {} : { link: `<${next.href}>; rel="next"` } });
      }
      return new Response(null, { status: 404 });
    },
  });
  return { state, origin: server.url.origin, async [Symbol.asyncDispose]() { await server.stop(true); } };
}

export const linkResult = z.object({ linkId: IdSchema, fileId: IdSchema, digest: DigestSchema, version: z.number() });
