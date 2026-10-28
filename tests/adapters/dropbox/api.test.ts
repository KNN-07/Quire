import { expect, test } from "bun:test";
import { DigestSchema } from "@quire/contracts";
import { contentHash, headerJson } from "../../../services/adapters/dropbox/model";
import { dropboxServer } from "./provider";
import { dropboxFixture, remotePath, scope } from "./harness";
import { localText } from "./local";

test("hashes empty Dropbox content without inventing a zero-length block", () => {
  // Given
  const bytes = new Uint8Array();
  // When
  const hash = contentHash(bytes);
  // Then
  expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("escapes non-ASCII API arguments without changing their decoded path", () => {
  // Given
  const path = "/t\u00e0i li\u1ec7u/\u4e2d\u6587.tex";
  // When
  const header = headerJson({ path });
  // Then
  expect(/^[\x20-\x7e]+$/.test(header)).toBe(true);
  expect(JSON.parse(header)).toEqual({ path });
});

test("round-trips non-ASCII remote paths into persisted source", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  provider.put(remotePath("t\u00e0i li\u1ec7u/\u4e2d\u6587.tex"), "Unicode \ud83d\ude00 source");
  // When
  await harness.success("initialSync");
  // Then
  expect(await localText(harness, "t\u00e0i li\u1ec7u/\u4e2d\u6587.tex")).toBe("Unicode \ud83d\ude00 source");
});

test("refreshes expired OAuth credentials before a due background synchronization", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  provider.put(remotePath("refreshed.txt"), "after refresh");
  harness.fixture.clock.advance(3600_000); provider.oauth.advance(3600_000);
  // When
  const failures = await harness.integration.scheduler.pump();
  // Then
  expect(failures).toEqual([]);
  expect(await localText(harness, "refreshed.txt")).toBe("after refresh");
  expect(await harness.fixture.runtime.db.get<{ version: number }>(
    "SELECT version FROM provider_grants WHERE id=?", [harness.grant.id])).toEqual({ version: 2 });
  await harness.fixture.runtime.repositories.assertReadable(scope.projectId);
});

test("preserves exact binary bytes across a Dropbox content-hash block boundary", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  const bytes = new Uint8Array(4 * 1024 * 1024 + 33);
  bytes.fill(91); bytes[0] = 0; bytes[4 * 1024 * 1024] = 255;
  provider.putBytes(remotePath("binary.dat"), bytes);
  const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
  // When
  await harness.success("initialSync");
  // Then
  const file = (await harness.fixture.service.listFiles(scope)).find(entry => entry.path === "binary.dat");
  expect(file?.blob).toBe(digest);
  expect(file?.editable).toBe(false);
  if (!file?.blob) throw new TypeError("Binary source blob missing");
  expect(await harness.fixture.runtime.blobs.get(file.blob)).toEqual(bytes);
});
