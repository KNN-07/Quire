import { expect, test } from "bun:test";
import { fetchPackage } from "../../../services/operations/updates/feed";
import { digest, ReleaseManifest, UpdateConfig } from "../../../services/operations/updates/model";
import { rejection } from "./rejection";

type File = { readonly path: string; readonly data: string; readonly executable: boolean };
const executable: File = { path: "bin/quire", data: "AQ==", executable: true };

async function readPackage(files: readonly File[], entrypoint = executable.path) {
  const bytes = JSON.stringify({ format: 1, entrypoint, files });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => new Response(bytes, { headers: { "content-type": "application/json" } }) });
  try {
    const config = UpdateConfig.parse({
      feedUrl: new URL("/feed", server.url).href, trustKeyPem: "not-used-by-package-download",
      installRoot: "/unused-package-path-test", installId: "package-path-test",
      currentVersion: "1.0.0", currentSequence: 1, schemaVersion: 1, allowLoopbackHttp: true,
      window: { start: "2026-10-27T00:00:00.000Z", end: "2030-01-01T00:00:00.000Z" },
    });
    const release = ReleaseManifest.parse({
      id: crypto.randomUUID(), version: "2.0.0", sequence: 2, security: false, notes: "",
      expiresAt: "2030-01-01T00:00:00.000Z", compatibleSchema: [1],
      packageUrl: new URL("/package", server.url).href,
      packageDigest: digest(bytes), packageBytes: Buffer.byteLength(bytes),
    });
    return await fetchPackage(config, { ...release, manifestDigest: digest(JSON.stringify(release)) });
  } finally {
    await server.stop(true);
  }
}

test("accepts required root metadata filenames in the digest-checked package", async () => {
  const files = [executable,
    { path: "installation-runtime.json", data: "e30=", executable: false },
    { path: "installation-roles.json", data: "e30=", executable: false }];
  expect((await readPackage(files)).files).toEqual(files);
});

for (const path of ["../escape", "/escape", "a/../escape", "a/./escape", "bin//quire", "a\\..\\escape"]) {
  test(`rejects unsafe package path ${path}`, async () => {
    expect(await rejection(readPackage([executable, { path, data: "e30=", executable: false }]))).toBeInstanceOf(Error);
  });
}

test("rejects duplicate root metadata paths", async () => {
  const file = { path: "installation-runtime.json", data: "e30=", executable: false };
  expect(await rejection(readPackage([executable, file, file]))).toMatchObject({ code: "UNSAFE_PACKAGE_PATH" });
});

test("requires the declared entrypoint to be an executable package member", async () => {
  expect(await rejection(readPackage([executable], "../escape"))).toMatchObject({ code: "PACKAGE_ENTRYPOINT_MISSING" });
  expect(await rejection(readPackage([{ ...executable, executable: false }]))).toMatchObject({ code: "PACKAGE_ENTRYPOINT_MISSING" });
});
