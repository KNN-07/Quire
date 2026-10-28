import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { S3Client } from "bun";
import { DigestSchema } from "@quire/contracts";
import { StorageError } from "@quire/runtime";
import { S3BlobStore } from "../../../../services/operations/storage/s3";
import { S3TestServer } from "./server";

const server = new S3TestServer();
async function failure(work: Promise<unknown>): Promise<unknown> {
  try { await work; } catch (error) { return error; }
  throw new Error("Expected backend operation to fail");
}
beforeAll(async () => { await server.create(); }, 60_000);
afterAll(async () => { await server.remove(); }, 60_000);

describe("authenticated S3 BlobStore", () => {
  test("round-trips binary subarrays, empty content and large bytes at content addresses", async () => {
    const store = new S3BlobStore(server.options());
    const backing = new Uint8Array([99, 0, 255, 128, 13, 10, 42]);
    const large = new Uint8Array(11 * 1024 * 1024 + 3);
    for (let index = 0; index < large.length; index++) large[index] = index % 251;
    for (const bytes of [new Uint8Array(), backing.subarray(1, 6), large,
      new TextEncoder().encode("source: \u{10437}\n\\documentclass{article}\n")]) {
      const expected = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
      const hash = await store.put(bytes);
      expect(hash).toBe(expected);
      expect(await new S3BlobStore(server.options()).get(hash)).toEqual(bytes);
      const raw = new Uint8Array(await new S3Client(server.options())
        .file(`${hash.slice(0, 2)}/${hash}`).arrayBuffer());
      expect(raw).toEqual(bytes);
      expect(await store.put(bytes)).toBe(hash);
    }
  }, 30_000);

  test("owns input bytes before upload and resolves only after the object can be read", async () => {
    const bytes = new Uint8Array([0, 255, 42]);
    const original = bytes.slice();
    const uploading = new S3BlobStore(server.options()).put(bytes);
    bytes.fill(17);
    const hash = await uploading;
    // This is the exact admission boundary for any subsequent SQL reference.
    expect(await new S3BlobStore(server.options()).get(hash)).toEqual(original);
    const hashes = await Promise.all(Array.from({ length: 4 }, () =>
      new S3BlobStore(server.options()).put(original)));
    expect(hashes).toEqual([hash, hash, hash, hash]);
  });

  test("persists source/history and artifact bytes through actual server and client replacement", async () => {
    const store = new S3BlobStore(server.options());
    const sources = [
      new TextEncoder().encode("\\documentclass{article}\nold history\n"),
      new TextEncoder().encode("\\documentclass{article}\nnew source\n"),
      new Uint8Array([37, 80, 68, 70, 45, 0, 255, 10]),
    ];
    const hashes = await Promise.all(sources.map(bytes => store.put(bytes)));
    await server.restart();
    const replacement = new S3BlobStore(server.options());
    for (const [index, source] of sources.entries()) {
      const hash = hashes[index];
      if (!hash) throw new Error("Missing uploaded digest");
      expect(await replacement.get(hash)).toEqual(source);
    }
  }, 60_000);

  test("detects an object replaced under its original digest", async () => {
    const store = new S3BlobStore(server.options());
    const hash = await store.put(new Uint8Array([1, 2, 3]));
    await server.overwrite(hash, new Uint8Array([3, 2, 1]));
    try {
      await store.get(hash);
      throw new Error("Corrupted read unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      if (!(error instanceof StorageError)) throw error;
      expect(error.code).toBe("BLOB_CORRUPTED");
      expect(error.resource).toBe(hash);
    }
  });

  test("reports missing objects, wrong credentials and failed uploads without returning a digest", async () => {
    const options = server.options();
    const missing = DigestSchema.parse("0".repeat(64));
    expect(await failure(new S3BlobStore(options).get(missing))).toMatchObject({ code: "NoSuchKey" });
    const wrong = new S3BlobStore({ ...options, secretAccessKey: "incorrect-secret" });
    expect(await failure(wrong.put(new Uint8Array([78])))).toMatchObject({ code: "SignatureDoesNotMatch" });
    const hash = await new S3BlobStore(options).put(new Uint8Array([79]));
    expect(await failure(wrong.get(hash))).toMatchObject({ code: "SignatureDoesNotMatch" });
    const absent = new S3BlobStore({ ...options, bucket: "missing-bucket" });
    expect(await failure(absent.put(new Uint8Array([80])))).toMatchObject({ code: "NoSuchBucket" });
    const anonymous = await fetch(`${options.endpoint}/${options.bucket}/${hash.slice(0, 2)}/${hash}`);
    expect(anonymous.status).toBe(403);
  });

  test("requires explicit credentials and rejects invalid digest paths", async () => {
    expect(() => new S3BlobStore({ ...server.options(), accessKeyId: "" })).toThrow("S3_CONFIG_INVALID");
    expect(() => new S3BlobStore({ ...server.options(), endpoint: "file:///tmp" })).toThrow("S3_CONFIG_INVALID");
    const store = new S3BlobStore(server.options());
    // Exercise an untyped caller without asserting that malformed input is a Digest.
    const invalidRead: unknown = Reflect.apply(store.get.bind(store), undefined, ["../not-a-digest"]);
    if (!(invalidRead instanceof Promise)) throw new Error("get must return a Promise");
    expect(await failure(invalidRead)).toBeInstanceOf(Error);
  });
});
