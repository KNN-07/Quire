import { createPublicKey, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { BackupError, digest } from "./model";

function publicKey(key: KeyObject): KeyObject {
  if (key.asymmetricKeyType !== "ed25519") throw new BackupError("BACKUP_SIGNER_INVALID", "Use an independent Ed25519 signing key");
  switch (key.type) {
    case "private": return createPublicKey(key);
    case "public": return key;
    case "secret": throw new BackupError("BACKUP_SIGNER_INVALID", "Symmetric instance keys are not archive signing authority");
    default: { const exhaustive: never = key.type; throw new BackupError("BACKUP_SIGNER_INVALID", exhaustive); }
  }
}
export function signerFingerprint(key: KeyObject) {
  return digest(publicKey(key).export({ type: "spki", format: "der" }));
}
export function signManifest(key: KeyObject, bytes: Uint8Array): Uint8Array {
  publicKey(key);
  return sign(null, Buffer.concat([Buffer.from("quire-full-recovery-v1\0"), bytes]), key);
}
export function verifyManifest(key: KeyObject, bytes: Uint8Array, signature: Uint8Array): boolean {
  return verify(null, Buffer.concat([Buffer.from("quire-full-recovery-v1\0"), bytes]), publicKey(key), signature);
}
