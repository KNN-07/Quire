import { constants } from "node:fs";
import { link, open, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { BackupError } from "./model";
import { syncDirectory, writeDurable } from "./files";
import { signerFingerprint } from "./signing";

/** A separate persistent signing key is never a member of the recovery archive. */
export async function loadBackupSigner(path: string, create: boolean): Promise<KeyObject> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
        throw new BackupError("BACKUP_SIGNER_PERMISSIONS", "Signer must be an owner-only regular file");
      }
      const key = createPrivateKey(await file.readFile());
      signerFingerprint(key);
      return key;
    } finally { await file.close(); }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    if (!create) throw new BackupError("BACKUP_SIGNER_REQUIRED", "Provision the independent Ed25519 signer before production startup");
  }
  const key = generateKeyPairSync("ed25519").privateKey;
  const staged = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  await writeDurable(staged, key.export({ type: "pkcs8", format: "pem" }));
  try {
    // Publish only complete, synced key bytes. Concurrent starters cannot read a partial PEM.
    await link(staged, path);
    await syncDirectory(dirname(path));
    return key;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    return loadBackupSigner(path, false);
  } finally { await rm(staged); }
}
