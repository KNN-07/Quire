import { mendeleyToken } from "./provider";

export const mendeleyGroupId = "9da69ed0-9d44-3d5f-b999-970f41c94c35";
export const otherMendeleyGroupId = "3463d2a0-f87e-3fea-a446-6c8287ce5a2f";

/** Owned provider implements the consulted Mendeley V2 groups / V1 documents wire contract. */
export function mendeleyGroupProvider() {
  const state = {
    groupTitle: "Group topology paper", groupStatus: 200, groupsStatus: 200,
    repeatGroups: false, escapeGroups: false, escapeDocuments: false,
    onRequest: undefined as (() => Promise<void>) | undefined,
    requests: [] as { path: string; accept: string | null }[],
  };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      state.requests.push({ path: url.pathname + url.search, accept: request.headers.get("accept") });
      if (request.headers.get("authorization") !== `Bearer ${mendeleyToken}`) return new Response(null, { status: 401 });
      if (state.onRequest) { const callback = state.onRequest; state.onRequest = undefined; await callback(); }
      if (url.pathname === "/groups/v2") {
        if (state.groupsStatus !== 200) return new Response(null, { status: state.groupsStatus });
        if (request.headers.get("accept") !== "application/vnd.mendeley-group-list+json") return new Response(null, { status: 406 });
        const second = url.searchParams.get("marker") === "second";
        const next = new URL(url);
        next.searchParams.set("marker", "second");
        return Response.json([second ?
          { id: mendeleyGroupId, name: "Topology reading group", role: "normal" } :
          { id: otherMendeleyGroupId, name: "Other authorized group", role: "follower" }],
        { headers: state.escapeGroups ? { link: '<https://foreign.invalid/groups/v2?marker=second>; rel="next"' } :
          !second || state.repeatGroups ? { link: `<${next.href}>; rel="next"` } : {} });
      }
      if (url.pathname.startsWith("/groups/v2/")) {
        if (state.groupStatus !== 200) return new Response(null, { status: state.groupStatus });
        if (request.headers.get("accept") !== "application/vnd.mendeley-group+json") return new Response(null, { status: 406 });
        return Response.json({ id: url.pathname.split("/").at(-1), name: "Topology reading group", role: "normal" });
      }
      if (url.pathname === "/documents" || url.pathname === "/search/catalog") {
        if (request.headers.get("accept") !== "application/vnd.mendeley-document.1+json") return new Response(null, { status: 406 });
        const group = url.searchParams.get("group_id");
        if (group && state.groupStatus !== 200) return new Response(null, { status: state.groupStatus });
        const marker = url.searchParams.get("marker");
        const next = new URL(url); next.searchParams.set("marker", "second");
        const groupSource = group === mendeleyGroupId;
        const title = groupSource ? `${state.groupTitle}${marker ? " supplement" : ""}` :
          url.pathname === "/search/catalog" ? "Individual catalog paper" : "Personal account paper";
        return Response.json([{ id: `${groupSource ? "group" : "personal"}-${marker ? 2 : 1}`,
          title, year: 2026, authors: [{ first_name: "Emmy", last_name: "Noether" }] }],
        { headers: state.escapeDocuments ? { link: '<https://foreign.invalid/documents?marker=second>; rel="next"' } :
          groupSource && !marker ? { link: `<${next.href}>; rel="next"` } : {} });
      }
      return new Response(null, { status: 404 });
    },
  });
  return { state, origin: server.url.origin, async [Symbol.asyncDispose]() { await server.stop(true); } };
}
