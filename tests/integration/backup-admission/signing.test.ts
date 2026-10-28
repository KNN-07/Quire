import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@quire/runtime";
import { loadBackupSigner } from "../../../services/operations/backups";
import { createApplication } from "../../../apps/server/src/composition";

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "quire-backup-signer-"));
  return {
    path, config: loadConfig({ QUIRE_DATA_DIR: path }),
    [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }),
  };
}

test("preserves independent signing authority when the native application reopens", async () => {
  // Given an initialized native backup signer and separately pinned public authority.
  await using files = await fixture();
  const original = await loadBackupSigner(join(files.path, "backup-signing.pem"), true);
  const trusted = createPublicKey(original);
  const message = new TextEncoder().encode("owned backup manifest");
  // When the application loads the same private file after restart.
  const reopened = await loadBackupSigner(join(files.path, "backup-signing.pem"), false);
  // Then its signatures still verify against the original pinned public key.
  expect(verify(null, message, trusted, sign(null, message, reopened))).toBe(true);
  expect((await stat(join(files.path, "backup-signing.pem"))).mode & 0o777).toBe(0o600);
});

test("fails closed when scale has no shared backup signer, even outside production", async () => {
  // Given scale configuration with no key-file selection.
  await using files = await fixture();
  const previous = process.env["QUIRE_BACKUP_SIGNING_KEY_FILE"];
  delete process.env["QUIRE_BACKUP_SIGNING_KEY_FILE"];
  try {
    // When application startup would otherwise generate a per-API signer.
    const provision = createApplication({ config: { ...files.config, profile: "scale" } });
    // Then it fails before constructing adapters or opening source storage.
    await rejects(provision, { code: "BACKUP_SIGNER_REQUIRED" });
  } finally {
    if (previous === undefined) delete process.env["QUIRE_BACKUP_SIGNING_KEY_FILE"];
    else process.env["QUIRE_BACKUP_SIGNING_KEY_FILE"] = previous;
  }
});

test("rejects a readable-by-others private signer before using its authority", async () => {
  // Given a genuine Ed25519 private key with public file permissions.
  await using files = await fixture();
  const path = join(files.path, "operator.pem");
  const { privateKey } = generateKeyPairSync("ed25519");
  await writeFile(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o644 });
  // When that exact file is selected for production.
  const provision = loadBackupSigner(path, false);
  // Then provisioning refuses the key rather than reducing validation.
  await rejects(provision, { code: "BACKUP_SIGNER_PERMISSIONS" });
});

test("requires shared archive storage for scale even when a signer is configured", async () => {
  // Given a valid independent signer but no shared destination selection.
  await using files = await fixture();
  const signingKey = generateKeyPairSync("ed25519").privateKey;
  const previous = process.env["QUIRE_BACKUP_ROOT"];
  delete process.env["QUIRE_BACKUP_ROOT"];
  try {
    // When scale startup would otherwise default to API-private storage.
    const startup = createApplication({ config: { ...files.config, profile: "scale" }, backups: { signingKey } });
    // Then it fails before constructing source adapters.
    await rejects(startup, { code: "BACKUP_ROOT_REQUIRED" });
  } finally {
    if (previous === undefined) delete process.env["QUIRE_BACKUP_ROOT"];
    else process.env["QUIRE_BACKUP_ROOT"] = previous;
  }
});
