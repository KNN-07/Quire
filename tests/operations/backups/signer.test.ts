import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBackupSigner } from "../../../services/operations/backups";
import { signerFingerprint, signManifest, verifyManifest } from "../../../services/operations/backups/signing";

test("publishes one complete owner-only signer during concurrent local startup", async () => {
  // Given a fresh owned signing-key path.
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-backup-signer-"));
  const path = join(root, "signer.pem");
  try {
    // When independent runtime startups provision it concurrently.
    const keys = await Promise.all([loadBackupSigner(path, true), loadBackupSigner(path, true)]);
    const [first, second] = keys;
    if (!first || !second) throw new TypeError("Both signer startups must return keys");
    // Then both use the same durable authority, which survives a fresh file open.
    const reopened = await loadBackupSigner(path, false);
    const bytes = new TextEncoder().encode("manifest bytes");
    expect(signerFingerprint(first)).toBe(signerFingerprint(second));
    expect(verifyManifest(reopened, bytes, signManifest(first, bytes))).toBe(true);
    expect((await stat(path)).mode & 0o077).toBe(0);
  } finally { await rm(root, { recursive: true }); console.info("BACKUP_SIGNER_CLEANED", root); }
});

test("requires a provisioned signer when automatic creation is disabled", async () => {
  // Given an owned production-style root with no signer.
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-backup-signer-"));
  try {
    // When key loading is requested without creation authority.
    const loaded = loadBackupSigner(join(root, "missing.pem"), false);
    // Then the system fails closed rather than silently replacing signing authority.
    await rejects(loaded, { code: "BACKUP_SIGNER_REQUIRED" });
  } finally { await rm(root, { recursive: true }); console.info("BACKUP_SIGNER_CLEANED", root); }
});
