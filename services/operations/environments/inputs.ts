import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { DigestSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { digest } from "./model";

export const PackageSchema = z.string().max(160).regex(/^(?:texlive-[a-z0-9-]+|fonts-[a-z0-9-]+)=[a-zA-Z0-9.+:~_-]+$/);
export function validateMirror(raw: string): URL {
  const url = new URL(raw);
  if (url.href !== new URL(process.env["QUIRE_ENVIRONMENT_MIRROR"] ?? "https://archive.ubuntu.com/ubuntu/").href || url.protocol !== "https:" || url.username ||
      url.password || url.search || url.hash || url.port || !url.pathname.endsWith("/") ||
      isIP(url.hostname) || !/^[a-z0-9.-]+$/.test(url.hostname) || url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    throw new ServiceError("MIRROR_DENIED", 422, "Build mirror must be the exact configured public HTTPS archive");
  }
  return url;
}
export function publicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  const third = octets[2] ?? 0;
  return first !== 0 && first !== 10 && first !== 127 && first < 224 &&
    !(first === 169 && second === 254) && !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && (second === 0 || second === 168)) &&
    !(first === 100 && second >= 64 && second <= 127) &&
    !(first === 198 && (second === 18 || second === 19 || second === 51 && third === 100)) &&
    !(first === 203 && second === 0 && third === 113);
}
export async function mirrorAddress(url: URL): Promise<string> {
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {
    throw new ServiceError("MIRROR_ADDRESS_DENIED", 422, "Configured mirror resolved to a reserved address");
  }
  const address = addresses[0]?.address;
  if (!address) throw new ServiceError("MIRROR_ADDRESS_DENIED", 422, "Configured mirror has no public IPv4 address");
  return address;
}
export async function fontInput(context: ModuleContext, input: { readonly id: Id; readonly actorId: Id }) {
  const rows = await context.db.all(`SELECT f.blob,f.bytes,f.path FROM files f
    JOIN branch_workspaces b ON b.id=f.branch_id JOIN projects p ON p.id=b.project_id
    WHERE f.id=? AND p.owner_id=? AND f.deleted_at IS NULL AND p.deleted_at IS NULL
    AND b.branch=p.default_branch AND f.link_json IS NULL`, [input.id,input.actorId]);
  if (rows.length !== 1) throw new ServiceError("FONT_UPLOAD_NOT_FOUND", 404, "Use a font file in your own project's default branch");
  const row = z.object({ blob: DigestSchema, bytes: z.number().int().positive().max(8 * 1024 * 1024),
    path: z.string().regex(/\.(?:otf|ttf)$/i) }).parse(rows[0]);
  const bytes = await context.blobs.get(row.blob);
  validateFont(bytes);
  if (bytes.length !== row.bytes || digest(bytes) !== row.blob) {
    throw new ServiceError("FONT_DIGEST_MISMATCH", 422, "Uploaded font does not match its immutable blob");
  }
  return { bytes, digest: row.blob, extension: row.path.toLowerCase().endsWith(".otf") ? "otf" : "ttf" };
}
export function validateFont(bytes: Uint8Array): void {
  const magic = Buffer.from(bytes.subarray(0,4)).toString("hex");
  if (bytes.length < 12 || bytes.length > 8 * 1024 * 1024 || !["00010000", "4f54544f"].includes(magic)) {
    throw new ServiceError("INVALID_FONT", 422, "Only bounded standalone OpenType or TrueType sfnt files are accepted");
  }
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const tables = view.getUint16(4);
  if (tables === 0 || tables > 256 || 12 + tables * 16 > bytes.length) {
    throw new ServiceError("INVALID_FONT", 422, "Font table directory is invalid");
  }
  for (let i=0;i<tables;i++) {
    const offset = view.getUint32(12+i*16+8);
    const size = view.getUint32(12+i*16+12);
    if (offset > bytes.length || size > bytes.length-offset) {
      throw new ServiceError("INVALID_FONT", 422, "Font table points outside the uploaded bytes");
    }
  }
}
