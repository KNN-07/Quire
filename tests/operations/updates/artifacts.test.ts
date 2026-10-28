import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { verify } from "node:crypto";
import { join } from "node:path";
import { Envelope, Feed, Package, digest } from "../../../services/operations/updates/model";

test("retains the exact real signed payload and digest-valid executable package as audit artifacts", async () => {
  // Given: historical fixture artifacts, not a currently available production release.
  const root = join(import.meta.dir, "../../../docs/evidence/p2o-updates");
  const envelope = Envelope.parse(JSON.parse(await readFile(join(root, "release-feed.json"), "utf8")));
  const key = await readFile(join(root, "trust-public.pem"), "utf8");
  const payload = Buffer.from(envelope.payload, "base64");
  const feed = Feed.parse(JSON.parse(payload.toString("utf8")));
  const bytes = Buffer.from(await readFile(join(root, "package.base64"), "utf8"), "base64");
  const release = feed.releases[0];
  if (!release) throw new TypeError("The retained release is missing");
  // When
  const verified = verify(null, payload, key, Buffer.from(envelope.signature, "base64"));
  // Then
  expect(verified).toBe(true);
  expect(digest(bytes)).toBe(release.packageDigest);
  expect(bytes.byteLength).toBe(release.packageBytes);
  expect(Package.parse(JSON.parse(bytes.toString("utf8"))).entrypoint).toBe("bin/quire");
});
