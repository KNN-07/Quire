import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { inventory, bundleManifestSchema } from "../../../deploy/runtime/manifest";
import { verifyBundle } from "../../../scripts/ops/airgap";
import { checked, freshDirectory } from "../../../deploy/runtime/artifacts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(architecture: string = process.arch) {
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-deployment-manifest-"));
  roots.push(root);
  const payload = join(root, "payload");
  await mkdir(payload);
  await writeFile(join(payload, "package"), "actual offline bytes\n");
  const keys = generateKeyPairSync("ed25519");
  const publicKey = join(root, "trusted.pem");
  await writeFile(publicKey, keys.publicKey.export({ type: "spki", format: "pem" }));
  const manifest = bundleManifestSchema.parse({
    format: "quire-airgap-v1", bun: "1.4.4", platform: "linux",
    architecture, images: [], files: await inventory(payload),
  });
  const bytes = Buffer.from(JSON.stringify(manifest));
  await writeFile(join(root, "manifest.json"), bytes);
  await writeFile(join(root, "manifest.sig"), sign(null, bytes, keys.privateKey));
  return { root, publicKey, payload, manifest };
}
async function rejection(result: Promise<unknown>): Promise<Error> {
  try { await result; }
  catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected the operation to reject");
}
describe("offline artifact verification", () => {
  it("accepts preserved bytes when the detached signature has the trusted key", async () => {
    // Given
    const value = await fixture();
    // When
    const result = await verifyBundle(value.root, value.publicKey);
    // Then
    expect(result.files).toEqual(value.manifest.files);
  });
  it("rejects tampering when a package changes after signing", async () => {
    // Given
    const value = await fixture();
    await writeFile(join(value.payload, "package"), "changed bytes");
    // When / Then
    expect(await rejection(verifyBundle(value.root, value.publicKey))).toMatchObject({ code: "BUNDLE_CONTENT_MISMATCH" });
  });
  it("rejects unknown files when a package is added after signing", async () => {
    // Given
    const value = await fixture();
    await writeFile(join(value.payload, "extra"), "unexpected");
    // When / Then
    expect(await rejection(verifyBundle(value.root, value.publicKey))).toMatchObject({ code: "BUNDLE_CONTENT_MISMATCH" });
  });
  it("rejects changed execution permissions when bytes still match", async () => {
    // Given
    const value = await fixture();
    await chmod(join(value.payload, "package"), 0o755);
    // When / Then
    expect(await rejection(verifyBundle(value.root, value.publicKey))).toMatchObject({ code: "BUNDLE_CONTENT_MISMATCH" });
  });
  it("rejects another signing identity when content is unchanged", async () => {
    // Given
    const value = await fixture();
    const other = generateKeyPairSync("ed25519");
    await writeFile(value.publicKey, other.publicKey.export({ type: "spki", format: "pem" }));
    // When / Then
    expect(await rejection(verifyBundle(value.root, value.publicKey))).toMatchObject({ code: "BUNDLE_SIGNATURE_INVALID" });
  });
  it("rejects symlink escapes when scanning payload files", async () => {
    // Given
    const value = await fixture();
    await symlink("/etc/passwd", join(value.payload, "escape"));
    // When / Then
    expect(await rejection(verifyBundle(value.root, value.publicKey))).toMatchObject({ code: "BUNDLE_SYMLINK_FORBIDDEN" });
  });
  it("rejects a signed bundle when it targets another host architecture", async () => {
    // Given
    const value = await fixture(process.arch === "x64" ? "arm64" : "x64");
    // When / Then
    expect(await rejection(verifyBundle(value.root, value.publicKey))).toMatchObject({ code: "BUNDLE_ARCHITECTURE_MISMATCH" });
  });
  it("reports failure when an invoked subprocess exits nonzero", async () => {
    // Given
    const command = [process.execPath, "-e", "process.exit(23)"];
    // When / Then
    expect(await rejection(checked(command))).toMatchObject({ code: "COMMAND_FAILED" });
  });
  it("refuses replacement when an installation directory already exists", async () => {
    // Given
    const value = await fixture();
    // When / Then
    expect(await rejection(freshDirectory(value.root))).toMatchObject({ code: "EEXIST" });
  });
  it("rejects production prefixes when asked to install under system paths", async () => {
    // Given
    const target = "/usr/local/quire-p2o-deployment-test";
    // When / Then
    expect(await rejection(freshDirectory(target))).toMatchObject({ code: "OWNED_PREFIX_REQUIRED" });
  });
});
