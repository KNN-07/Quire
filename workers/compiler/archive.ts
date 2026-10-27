import { ServiceError } from "@quire/runtime";
import { ProjectPathSchema } from "@quire/contracts";

/** Only regular USTAR files are accepted; links and special entries never materialize. */
export function readTar(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  const text = (offset: number, size: number) => decoder.decode(bytes.subarray(offset, offset + size)).replace(/\0.*$/s, "");
  for (let offset = 0; offset + 512 <= bytes.length;) {
    if (bytes.subarray(offset, offset + 512).every((value) => value === 0)) break;
    const prefix = text(offset + 345, 155);
    const name = `${prefix ? `${prefix}/` : ""}${text(offset, 100)}`.replace(/^\.\//, "");
    const size = Number.parseInt(text(offset + 124, 12).trim(), 8);
    const kind = text(offset + 156, 1);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) {
      throw new ServiceError("INVALID_ARCHIVE", 422, "Worker returned a truncated archive");
    }
    if (kind === "0" || kind === "") {
      ProjectPathSchema.parse(name);
      files.set(name, bytes.slice(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
