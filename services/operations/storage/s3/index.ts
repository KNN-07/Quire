import { S3Client } from "bun";
import { DigestSchema } from "@quire/contracts";
import type { BlobStore, Digest } from "@quire/contracts";
import { StorageError } from "@quire/runtime";

export type S3BlobStoreOptions = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly virtualHostedStyle?: boolean;
};

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;
  private readonly authority: { readonly endpoint: string; readonly bucket: string };

  constructor(options: S3BlobStoreOptions) {
    for (const field of ["endpoint", "bucket", "region", "accessKeyId", "secretAccessKey"] as const) {
      if (!options[field].trim()) throw new StorageError("S3_CONFIG_INVALID", field);
    }
    const endpoint = new URL(options.endpoint);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      throw new StorageError("S3_CONFIG_INVALID", "endpoint");
    }
    this.client = new S3Client(options);
    this.authority = { endpoint: (endpoint.origin + endpoint.pathname).replace(/\/$/, ""), bucket: options.bucket };
  }

  /** No credentials escape this read-only, actual bucket probe. */
  async restoreIdentity() {
    const listing = await this.client.list({ maxKeys: 1 });
    return { ...this.authority, empty: listing.keyCount === 0 && !listing.isTruncated &&
      (listing.contents?.length ?? 0) === 0 };
  }

  async put(bytes: Uint8Array): Promise<Digest> {
    // Own the bytes across the upload await: caller mutation must not change the
    // object after its content address has been calculated.
    const content = new Uint8Array(bytes);
    const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(content).digest("hex"));
    await this.client.file(`${digest.slice(0, 2)}/${digest}`).write(content);
    return digest;
  }

  async get(hash: Digest): Promise<Uint8Array> {
    const digest = DigestSchema.parse(hash);
    const bytes = new Uint8Array(await this.client.file(`${digest.slice(0, 2)}/${digest}`).arrayBuffer());
    const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (actual !== digest) throw new StorageError("BLOB_CORRUPTED", digest);
    return bytes;
  }
}
