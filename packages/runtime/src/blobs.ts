import { mkdir, open, readFile, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DigestSchema } from "@quire/contracts";
import type { BlobStore, Digest, Clock, Transaction } from "@quire/contracts";
import { StorageError } from "./errors";

export class DiskBlobStore implements BlobStore {
  constructor(readonly root: string) {}
  async put(bytes: Uint8Array): Promise<Digest> {
    const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    const dir = join(this.root, digest.slice(0, 2));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const parent = await open(this.root, "r");
    try { await parent.sync(); } finally { await parent.close(); }
    const temp = join(dir, `.put-${crypto.randomUUID()}`);
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally { await file.close(); }
    try {
      await link(temp, join(dir, digest));
      const directory = await open(dir, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    } finally { await unlink(temp); }
    return digest;
  }
  async get(hash: Digest): Promise<Uint8Array> {
    const bytes = await readFile(join(this.root, hash.slice(0, 2), hash));
    const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (actual !== hash) throw new StorageError("BLOB_CORRUPTED", hash);
    return bytes;
  }
}
export async function referenceBlob(db: Transaction, blob: {
  readonly digest: Digest; readonly bytes: number;
}, clock: Clock): Promise<void> {
  await db.run("INSERT INTO blobs(digest,bytes,created_at) VALUES(?,?,?) ON CONFLICT(digest) DO NOTHING",
    [blob.digest, blob.bytes, clock.now()]);
}
