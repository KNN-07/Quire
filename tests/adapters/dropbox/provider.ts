import { z } from "zod";
import { contentHash, remoteFile, headerJson } from "../../../services/adapters/dropbox/model";
import type { remoteEntry } from "../../../services/adapters/dropbox/model";
import type { RemoteFile } from "../../../services/adapters/dropbox/model";
import { oauthFixture } from "./oauth";

type Entry = z.infer<typeof remoteEntry>;
type Cursor = { readonly position: number; readonly entries: readonly Entry[]; readonly offset: number };
export function dropboxServer() {
  const oauth = oauthFixture();
  const files = new Map<string, { readonly metadata: RemoteFile; readonly bytes: Uint8Array }>();
  const revisions = new Map<string, { readonly metadata: RemoteFile; readonly bytes: Uint8Array }>();
  const changes: Entry[] = [], observed: string[] = [];
  const cursors = new Map<string, Cursor>();
  let sequence = 0, uploads = 0, deletes = 0, reset = false;
  let failure: { readonly route: string; readonly status: number; readonly after: boolean } | null = null;
  let gate: { readonly route: string; readonly entered: ReturnType<typeof Promise.withResolvers<void>>;
    readonly release: ReturnType<typeof Promise.withResolvers<void>> } | null = null;
  const error = (status: number, summary: string) => Response.json({ error_summary: summary, error: { ".tag": summary.split("/")[0] } },
    { status, headers: status === 429 ? { "retry-after": "30" } : {} });
  const put = (path: string, bytes: Uint8Array, id?: string) => {
    sequence++;
    const previous = files.get(path.toLowerCase());
    const metadata = remoteFile.parse({ ".tag": "file", path_display: path, path_lower: path.toLowerCase(),
      id: id ?? previous?.metadata.id ?? `id:file-${sequence}`, rev: `rev-${sequence}`, size: bytes.length, content_hash: contentHash(bytes) });
    const stored = { metadata, bytes };
    files.set(path.toLowerCase(), stored); revisions.set(metadata.rev, stored); changes.push(metadata);
    return metadata;
  };
  const remove = (path: string) => {
    for (const key of files.keys()) if (key === path.toLowerCase() || key.startsWith(`${path.toLowerCase()}/`)) files.delete(key);
    changes.push({ ".tag": "deleted", path_lower: path.toLowerCase(), path_display: path });
  };
  const page = (state: Cursor) => {
    const entries = state.entries.slice(state.offset, state.offset + 2), offset = state.offset + entries.length;
    const more = offset < state.entries.length, cursor = crypto.randomUUID();
    cursors.set(cursor, more ? { ...state, offset } : { position: state.position, entries: [], offset: 0 });
    return Response.json({ entries, cursor, has_more: more });
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const route = new URL(request.url).pathname;
    observed.push(route);
    const auth = await oauth.handle(request);
    if (auth) return auth;
    if (request.method !== "POST" || !oauth.accepts(request)) return error(401, "invalid_access_token/");
    const pending = gate;
    if (pending?.route === route) { gate = null; pending.entered.resolve(); await pending.release.promise; }
    const fail = failure?.route === route ? failure : null;
    if (fail) failure = null;
    if (fail && !fail.after) return error(fail.status, "too_many_requests/");
    if (route === "/2/files/download") {
      const args = z.object({ path: z.string() }).parse(JSON.parse(request.headers.get("dropbox-api-arg") ?? "null"));
      const file = revisions.get(args.path.replace(/^rev:/, ""));
      return file ? new Response(new Uint8Array(file.bytes).buffer, { headers: { "dropbox-api-result": headerJson(file.metadata) } }) : error(409, "path/not_found/");
    }
    if (route === "/2/files/upload") {
      const args = z.object({ path: z.string(), mode: z.union([z.literal("add"), z.object({ ".tag": z.literal("update"), update: z.string() })]),
        strict_conflict: z.literal(true), autorename: z.literal(false), content_hash: z.string() })
        .parse(JSON.parse(request.headers.get("dropbox-api-arg") ?? "null"));
      const bytes = new Uint8Array(await request.arrayBuffer()), existing = files.get(args.path.toLowerCase());
      if (contentHash(bytes) !== args.content_hash) return error(409, "content_hash_mismatch/");
      if ((args.mode === "add" && existing) || (typeof args.mode !== "string" && existing?.metadata.rev !== args.mode.update)) {
        return error(409, "path/conflict/file/");
      }
      uploads++;
      const metadata = put(args.path, bytes);
      return fail?.after ? error(fail.status, "internal_error/") : Response.json(metadata);
    }
    const body: unknown = await request.json();
    if (route === "/2/files/list_folder") {
      z.object({ path: z.literal(""), recursive: z.literal(true), include_deleted: z.literal(true),
        include_non_downloadable_files: z.literal(false) }).parse(body);
      return page({ position: changes.length, entries: [...files.values()].map(file => file.metadata), offset: 0 });
    }
    if (route === "/2/files/list_folder/continue") {
      const args = z.object({ cursor: z.string() }).parse(body), previous = cursors.get(args.cursor);
      if (reset || !previous) { reset = false; return error(409, "reset/"); }
      return page(previous.entries.length ? previous : { position: changes.length, entries: changes.slice(previous.position), offset: 0 });
    }
    if (route === "/2/files/get_metadata") {
      const args = z.object({ path: z.string() }).parse(body);
      const file = files.get(args.path.toLowerCase());
      return file ? Response.json(file.metadata) : error(409, "path/not_found/");
    }
    if (route === "/2/files/delete_v2") {
      const args = z.object({ path: z.string(), parent_rev: z.string() }).parse(body);
      const file = files.get(args.path.toLowerCase());
      if (!file || file.metadata.rev !== args.parent_rev) return error(409, "path_write/conflict/");
      remove(args.path); deletes++; return Response.json({ metadata: file.metadata });
    }
    return error(404, "not_found/");
  } });
  return { origin: server.url.origin, observed, oauth,
    get uploads() { return uploads; }, get deletes() { return deletes; },
    text(path: string) { const file = files.get(path.toLowerCase()); return file ? new TextDecoder().decode(file.bytes) : null; },
    put(path: string, text: string) { return put(path, new TextEncoder().encode(text)); }, remove,
    putBytes(path: string, bytes: Uint8Array) { return put(path, bytes); },
    rename(from: string, to: string) {
      const previous = files.get(from.toLowerCase()); if (!previous) throw new TypeError("Missing rename source");
      remove(from); return put(to, previous.bytes, previous.metadata.id);
    },
    resetCursor() { reset = true; },
    failNext(route: string, status: number, after = false) { failure = { route, status, after }; },
    pause(route: string) {
      if (gate) throw new TypeError("Fixture barrier already active");
      const pending = { route, entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
      gate = pending;
      return { entered: pending.entered.promise, release: () => pending.release.resolve() };
    },
    async [Symbol.asyncDispose]() { gate?.release.resolve(); await server.stop(true); },
  };
}
