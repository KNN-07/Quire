import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { contentHash, headerJson, remoteFile } from "../../services/adapters/dropbox/model";
import type { RemoteFile } from "../../services/adapters/dropbox/model";

const authorization = z.object({
  client_id: z.literal("quire-app"), redirect_uri: z.url(), response_type: z.literal("code"),
  scope: z.literal("files.metadata.read files.content.read files.content.write"),
  code_challenge_method: z.literal("S256"), code_challenge: z.string().length(43),
  token_access_type: z.literal("offline"), state: z.string().min(43),
});
type StoredFile = { readonly metadata: RemoteFile; readonly bytes: Uint8Array };

/** Stateful protocol provider; only owned loopback data and exact revision-conditional writes. */
export function dropboxProvider() {
  const codes = new Map<string, z.infer<typeof authorization>>();
  const tokens = new Set<string>();
  const files = new Map<string, StoredFile>();
  const cursors = new Map<string, number>();
  const changes: RemoteFile[] = [];
  const requests: string[] = [];
  let sequence = 0;
  const error = (status: number, summary: string) => Response.json({ error_summary: summary }, { status });
  function put(path: string, bytes: Uint8Array) {
    sequence++;
    const metadata = remoteFile.parse({ ".tag": "file", id: files.get(path.toLowerCase())?.metadata.id ?? `id:${sequence}`,
      path_display: path, path_lower: path.toLowerCase(), rev: `rev-${sequence}`, size: bytes.length, content_hash: contentHash(bytes) });
    files.set(path.toLowerCase(), { metadata, bytes }); changes.push(metadata);
    return metadata;
  }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    requests.push(url.pathname);
    if (url.pathname === "/authorize") {
      const parsed = authorization.parse(Object.fromEntries(url.searchParams));
      if (!["127.0.0.1", "localhost"].includes(new URL(parsed.redirect_uri).hostname)) return error(400, "invalid_redirect");
      const code = randomBytes(24).toString("hex"); codes.set(code, parsed);
      const target = new URL(parsed.redirect_uri); target.searchParams.set("code", code); target.searchParams.set("state", parsed.state);
      return Response.redirect(target, 303);
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(await request.text());
      if (form.get("client_id") !== "quire-app" || form.get("client_secret") !== "dropbox-client-secret") return error(401, "invalid_client");
      const code = form.get("code") ?? "", saved = codes.get(code);
      codes.delete(code);
      if (form.get("grant_type") !== "authorization_code" || !saved || saved.redirect_uri !== form.get("redirect_uri")
        || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== saved.code_challenge) return error(400, "invalid_grant");
      const token = randomBytes(24).toString("hex"); tokens.add(token);
      return Response.json({ access_token: token, token_type: "bearer", expires_in: 3600 });
    }
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (request.method !== "POST" || !tokens.has(token)) return error(401, "invalid_access_token/");
    if (url.pathname === "/2/auth/token/revoke") { tokens.delete(token); return Response.json(null); }
    if (url.pathname === "/2/files/upload") {
      const args = z.object({ path: z.string(), mode: z.union([z.literal("add"), z.object({ ".tag": z.literal("update"), update: z.string() })]),
        strict_conflict: z.literal(true), autorename: z.literal(false), content_hash: z.string() })
        .parse(JSON.parse(request.headers.get("dropbox-api-arg") ?? "null"));
      const bytes = new Uint8Array(await request.arrayBuffer()), previous = files.get(args.path.toLowerCase());
      if (contentHash(bytes) !== args.content_hash) return error(409, "content_hash_mismatch/");
      if ((args.mode === "add" && previous) || (typeof args.mode !== "string" && previous?.metadata.rev !== args.mode.update)) return error(409, "path/conflict/");
      return Response.json(put(args.path, bytes));
    }
    if (url.pathname === "/2/files/download") {
      const args = z.object({ path: z.string() }).parse(JSON.parse(request.headers.get("dropbox-api-arg") ?? "null"));
      const file = [...files.values()].find(entry => `rev:${entry.metadata.rev}` === args.path);
      return file ? new Response(new Uint8Array(file.bytes).buffer, { headers: { "dropbox-api-result": headerJson(file.metadata) } }) : error(409, "path/not_found/");
    }
    const body: unknown = await request.json();
    if (url.pathname === "/2/files/list_folder" || url.pathname === "/2/files/list_folder/continue") {
      let entries: readonly RemoteFile[];
      if (url.pathname.endsWith("/continue")) {
        const args = z.object({ cursor: z.string() }).parse(body), position = cursors.get(args.cursor);
        if (position === undefined) return error(409, "reset/");
        entries = changes.slice(position);
      } else {
        z.object({ path: z.literal(""), recursive: z.literal(true), include_deleted: z.literal(true), include_non_downloadable_files: z.literal(false) }).parse(body);
        entries = [...files.values()].map(file => file.metadata);
      }
      const cursor = crypto.randomUUID(); cursors.set(cursor, changes.length);
      return Response.json({ entries, cursor, has_more: false });
    }
    if (url.pathname === "/2/files/get_metadata") {
      const args = z.object({ path: z.string() }).parse(body), file = files.get(args.path.toLowerCase());
      return file ? Response.json(file.metadata) : error(409, "path/not_found/");
    }
    if (url.pathname === "/2/files/delete_v2") {
      const args = z.object({ path: z.string(), parent_rev: z.string() }).parse(body), file = files.get(args.path.toLowerCase());
      if (!file || file.metadata.rev !== args.parent_rev) return error(409, "path/conflict/");
      files.delete(args.path.toLowerCase());
      return Response.json({ metadata: { ".tag": "deleted", path_display: args.path, path_lower: args.path.toLowerCase() } });
    }
    return error(404, "unknown_route/");
  } });
  return { origin: server.url.origin, files, requests, put,
    endpoints: { rpc: `${server.url.origin}/2/`, content: `${server.url.origin}/2/`, authorization: `${server.url.origin}/authorize`, token: `${server.url.origin}/token` },
    async [Symbol.asyncDispose]() { await server.stop(true); },
  };
}
