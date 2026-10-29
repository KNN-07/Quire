import { z } from "zod";
import { assertNever } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { SafeHttpClient, GrantContext, HttpResponse } from "../shared";
import { contentHash, headerJson, remoteEntry, remoteFile, remoteFolder } from "./model";
import type { RemoteFile } from "./model";

export type DropboxEndpoints = {
  readonly rpc: string; readonly content: string; readonly authorization: string; readonly token: string;
};
export const dropboxEndpoints: DropboxEndpoints = {
  rpc: "https://api.dropboxapi.com/2/", content: "https://content.dropboxapi.com/2/",
  authorization: "https://www.dropbox.com/oauth2/authorize", token: "https://api.dropboxapi.com/oauth2/token",
};
export class DropboxError extends ServiceError {
  constructor(readonly remoteStatus: number, readonly summary: string, readonly retryAfter: number) {
    super(remoteStatus === 429 ? "DROPBOX_RATE_LIMIT" : remoteStatus === 409 ? "DROPBOX_CONFLICT" : "DROPBOX_HTTP_ERROR",
      remoteStatus === 429 || remoteStatus === 409 ? 409 : 502, `Dropbox returned HTTP ${remoteStatus}`);
  }
}
export class DropboxApi {
  constructor(private readonly http: SafeHttpClient, private readonly endpoints: DropboxEndpoints,
    private readonly context: GrantContext, private readonly binding?: { readonly folder_id: string; readonly path: string }) {}
  private writePath(path: string): string {
    if (!this.binding) return path;
    if (!path.toLowerCase().startsWith(`${this.binding.path.toLowerCase()}/`)) {
      throw new ServiceError("DROPBOX_FOLDER_SCOPE", 409, "Write is outside the bound Dropbox folder");
    }
    return `${this.binding.folder_id}${path.slice(this.binding.path.length)}`;
  }
  private async checked(response: HttpResponse): Promise<HttpResponse> {
    if (response.status >= 200 && response.status < 300) return response;
    let summary = "";
    try {
      const body = z.object({ error_summary: z.string() }).safeParse(JSON.parse(new TextDecoder().decode(response.bytes)));
      if (body.success) summary = body.data.error_summary;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const retry = Number(response.headers.get("retry-after") ?? "1");
    throw new DropboxError(response.status, summary,
      Number.isFinite(retry) && retry >= 0 ? Math.min(retry, 86400) : 1);
  }
  async rpc<T extends z.ZodType>(route: string, input: unknown, schema: T): Promise<z.output<T>> {
    const response = await this.checked(await this.http.request(new URL(route, this.endpoints.rpc).href, {
      method: "POST", headers: { authorization: `Bearer ${this.context.tokens.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(input), signal: this.context.signal,
    }));
    return schema.parse(JSON.parse(new TextDecoder().decode(response.bytes)));
  }
  async list(input: { readonly root: string; readonly cursor: string | null; readonly remote: readonly RemoteFile[] }) {
    const files = new Map(input.remote.map(file => [file.path_lower, file]));
    let cursor = input.cursor;
    let reset = false;
    for (let page = 0; page < 1000; page++) {
      let result;
      try {
        result = await this.rpc(cursor === null ? "files/list_folder" : "files/list_folder/continue",
          cursor === null ? { path: input.root, recursive: true, include_deleted: true, include_non_downloadable_files: false }
            : { cursor },
          z.object({ entries: z.array(remoteEntry), cursor: z.string().min(1), has_more: z.boolean() }));
      } catch (error) {
        if (error instanceof DropboxError && error.remoteStatus === 409 && error.summary.startsWith("reset/") && !reset) {
          cursor = null; reset = true; files.clear(); continue;
        }
        throw error;
      }
      for (const entry of result.entries) {
        switch (entry[".tag"]) {
          case "file":
            for (const key of files.keys()) if (key.startsWith(`${entry.path_lower}/`)) files.delete(key);
            files.set(entry.path_lower, entry); break;
          case "deleted":
            for (const key of files.keys()) if (key === entry.path_lower || key.startsWith(`${entry.path_lower}/`)) files.delete(key);
            break;
          case "folder": files.delete(entry.path_lower); break;
          default: assertNever(entry);
        }
      }
      cursor = result.cursor;
      if (!result.has_more) return { cursor, files: [...files.values()] };
    }
    throw new ServiceError("DROPBOX_PAGE_LIMIT", 502, "Dropbox listing exceeded 1000 pages");
  }
  async folder(id: string) {
    const folder = await this.rpc("files/get_metadata", { path: id, include_deleted: false }, remoteFolder);
    if (folder.id !== id) throw new ServiceError("DROPBOX_FOLDER_CHANGED", 409, "Selected Dropbox folder identity changed");
    return folder;
  }
  /** Discovery includes unsupported files so an import never silently drops them. */
  async entries(path: string, recursive: boolean, maximum: number) {
    const entries: Readonly<Record<string, unknown>>[] = [];
    let cursor: string | null = null;
    for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
      const page: { entries: Record<string, unknown>[]; cursor: string; has_more: boolean } =
        await this.rpc(cursor === null ? "files/list_folder" : "files/list_folder/continue",
          cursor === null ? { path, recursive, include_deleted: false, include_non_downloadable_files: true, limit: 200 }
            : { cursor }, z.object({
            entries: z.array(z.record(z.string(), z.unknown())), cursor: z.string().min(1), has_more: z.boolean(),
          }));
      entries.push(...page.entries);
      if (entries.length > maximum) throw new ServiceError("DROPBOX_ENTRY_LIMIT", 413, "Dropbox folder exceeds the import entry limit");
      cursor = page.cursor;
      if (!page.has_more) return { entries, cursor };
    }
    throw new ServiceError("DROPBOX_PAGE_LIMIT", 502, "Dropbox listing exceeded 1000 pages");
  }
  async download(file: RemoteFile): Promise<Uint8Array> {
    const response = await this.checked(await this.http.request(new URL("files/download", this.endpoints.content).href, {
      method: "POST", headers: { authorization: `Bearer ${this.context.tokens.accessToken}`,
        "dropbox-api-arg": headerJson({ path: `rev:${file.rev}` }) }, signal: this.context.signal,
    }));
    const metadata = remoteFile.parse(JSON.parse(response.headers.get("dropbox-api-result") ?? "null"));
    if (metadata.rev !== file.rev || metadata.id !== file.id || response.bytes.length !== file.size
      || contentHash(response.bytes) !== file.content_hash) {
      throw new ServiceError("DROPBOX_INTEGRITY", 502, "Dropbox download revision or content hash differs");
    }
    return response.bytes;
  }
  async upload(input: { readonly path: string; readonly bytes: Uint8Array; readonly previous: RemoteFile | null }) {
    const response = await this.checked(await this.http.request(new URL("files/upload", this.endpoints.content).href, {
      method: "POST", headers: { authorization: `Bearer ${this.context.tokens.accessToken}`, "content-type": "application/octet-stream",
        "dropbox-api-arg": headerJson({ path: this.writePath(input.path), mode: input.previous ? { ".tag": "update", update: input.previous.rev } : "add",
          strict_conflict: true, autorename: false, mute: true, content_hash: contentHash(input.bytes) }) },
      body: input.bytes, signal: this.context.signal,
    }));
    const file = remoteFile.parse(JSON.parse(new TextDecoder().decode(response.bytes)));
    if (file.content_hash !== contentHash(input.bytes) || file.size !== input.bytes.length || file.path_lower !== input.path.toLowerCase()) {
      throw new ServiceError("DROPBOX_INTEGRITY", 502, "Dropbox upload path, size or content hash differs");
    }
    return file;
  }
  async delete(file: RemoteFile): Promise<void> {
    await this.rpc("files/delete_v2", { path: this.writePath(file.path_display), parent_rev: file.rev }, z.object({ metadata: remoteEntry }));
  }
  async revoke(): Promise<void> { await this.rpc("auth/token/revoke", null, z.null()); }
}
