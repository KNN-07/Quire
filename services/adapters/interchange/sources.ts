import { z } from "zod";
import { assertNever } from "@quire/contracts";
import type { Id, ImportSourceSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { SafeHttpClient } from "../shared";
import { limits } from "../../core/base/limits";
import type { ImportUploads } from "./uploads";

export type ImportSource = z.infer<typeof ImportSourceSchema> | File;
export type ResolvedSource = {
  readonly bytes: Uint8Array; readonly mime: string; readonly filename: string;
};
const mimeNames = {
  "application/zip": "source.zip", "application/x-zip-compressed": "source.zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "original.docx",
  "text/markdown": "original.md", "text/plain": "main.tex", "application/x-tex": "main.tex",
} as const;
export function bounded(bytes: Uint8Array): Uint8Array {
  if (bytes.length > limits.uploadBytes) throw new ServiceError("UPLOAD_LIMIT", 413, "Import exceeds configured upload byte limit");
  if (!bytes.length) throw new ServiceError("IMPORT_EMPTY", 422, "Import source is empty");
  return bytes;
}
/** Public direct-download links only. Drive login/confirmation pages are not files. */
export async function fetchSource(http: SafeHttpClient, url: string): Promise<ResolvedSource> {
  const response = await http.request(url, { maxBytes: limits.uploadBytes });
  if (response.status < 200 || response.status >= 300) throw new ServiceError("IMPORT_HTTP_ERROR", 422,
    `Direct download returned HTTP ${response.status}; supply a public file download URL or upload the file`);
  const mime = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "application/octet-stream";
  const start = new TextDecoder().decode(response.bytes.subarray(0, 256)).trimStart();
  if (mime === "text/html" || /^<!doctype html|^<html/i.test(start)) throw new ServiceError("IMPORT_LANDING_PAGE", 422,
    "URL returned a web/login/Drive confirmation page; use the file's public webContentLink/export link or upload it manually");
  const disposition = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1];
  const filename = disposition?.split(/[\\/]/).at(-1) || new URL(url).pathname.split("/").at(-1) || "download";
  return { bytes: bounded(response.bytes), mime, filename };
}
export async function resolveSource(http: SafeHttpClient, source: ImportSource,
  staging?: { readonly actorId: Id; readonly uploads: ImportUploads }): Promise<ResolvedSource> {
  if (source instanceof File) return { bytes: bounded(new Uint8Array(await source.arrayBuffer())), mime: source.type, filename: source.name };
  switch (source.kind) {
    case "snippet": return { bytes: bounded(new TextEncoder().encode(source.text)), mime: "text/plain", filename: "main.tex" };
    case "url": return fetchSource(http, source.url);
    case "data-url": {
      const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(source.dataUrl);
      const [, mime, base64, data] = z.tuple([z.string(), z.string(), z.string().optional(), z.string()]).parse(match);
      const filename = Object.entries(mimeNames).find(([key]) => key === mime)?.[1];
      if (!filename) throw new ServiceError("IMPORT_MEDIA_TYPE", 422, "Data URL must contain ZIP, DOCX, Markdown or TeX/plain text");
      if (data.length > limits.uploadBytes * 4) throw new ServiceError("UPLOAD_LIMIT", 413, "Data URL exceeds configured upload limit");
      let bytes: Uint8Array;
      try {
        bytes = base64 ? Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
          : new TextEncoder().encode(decodeURIComponent(data));
      } catch (error) {
        if (error instanceof Error) throw new ServiceError("IMPORT_DATA_URL", 422, "Malformed data URL encoding");
        throw error;
      }
      return { bytes: bounded(bytes), mime, filename };
    }
    case "upload":
      if (!staging) throw new ServiceError("UPLOAD_ACTOR_REQUIRED", 401, "Retrieve staged uploads through the authenticated import API");
      return staging.uploads.read(staging.actorId, source.uploadId);
    case "git": throw new ServiceError("REMOTE_IMPORT_REQUIRED", 503, "Remote Git import must use the configured remote Git contribution");
    default: return assertNever(source);
  }
}
