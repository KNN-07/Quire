import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { z } from "zod";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import type { BackupContext } from "./model";
import { BackupError, repositorySchema } from "./model";

/** Git's standard non-delta pack format, checked again by index-pack --strict on import. */
export function packObjects(batch: Uint8Array): { readonly bytes: Uint8Array; readonly count: number } {
  const buffer = Buffer.from(batch);
  const entries: Uint8Array[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const end = buffer.indexOf(10, offset);
    if (end < 0) throw new BackupError("BACKUP_GIT_INVALID", "Truncated object header");
    const [oid, type, sizeText] = buffer.subarray(offset, end).toString().split(" ");
    const size = z.coerce.number().int().nonnegative().parse(sizeText);
    const tag = z.enum(["commit", "tree", "blob", "tag"]).parse(type);
    const value = buffer.subarray(end + 1, end + 1 + size);
    if (value.length !== size || buffer[end + 1 + size] !== 10) throw new BackupError("BACKUP_GIT_INVALID", "Truncated object");
    if (createHash("sha1").update(`${tag} ${size}\0`).update(value).digest("hex") !== oid) {
      throw new BackupError("BACKUP_GIT_INVALID", "Object identity mismatch");
    }
    const types = { commit: 1, tree: 2, blob: 3, tag: 4 } as const;
    const header = [(types[tag] << 4) | (size & 15)];
    let remainder = Math.floor(size / 16);
    while (remainder > 0) {
      const previous = header.pop();
      if (previous === undefined) throw new BackupError("BACKUP_GIT_INVALID", "Empty object header");
      header.push(previous | 128, remainder & 127);
      remainder = Math.floor(remainder / 128);
    }
    entries.push(Buffer.from(header), deflateSync(value));
    offset = end + size + 2;
  }
  const header = Buffer.alloc(12);
  header.write("PACK"); header.writeUInt32BE(2, 4); header.writeUInt32BE(entries.length / 2, 8);
  const data = Buffer.concat([header, ...entries]);
  return { bytes: Buffer.concat([data, createHash("sha1").update(data).digest()]), count: entries.length / 2 };
}
export async function exportRepository(context: BackupContext, project: string) {
  const projectId = IdSchema.parse(project);
  const refs = new TextDecoder().decode(await context.repositories.objects(projectId,
    ["for-each-ref", "--format=%(refname) %(objectname)"])).trim();
  const batch = await context.repositories.objects(projectId, ["cat-file", "--batch-all-objects", "--batch"]);
  const pack = packObjects(batch);
  const metadata = repositorySchema.parse({
    projectId, objects: pack.count, refs: refs ? refs.split("\n").map(line => {
      const [ref, oid] = line.split(" ");
      return { ref, oid: GitOidSchema.parse(`sha1:${oid}`) };
    }) : [],
  });
  return { metadata, pack: pack.bytes };
}
