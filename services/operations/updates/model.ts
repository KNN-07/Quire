import { z } from "zod";
import { createHash } from "node:crypto";
import { IdSchema, InstantSchema, DigestSchema } from "@quire/contracts";
import type { Digest } from "@quire/contracts";
import type { MigrationEvidence } from "../installation/model";

export class UpdateError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "UpdateError"; }
}
export const digest = (bytes: Uint8Array | string): Digest => DigestSchema.parse(createHash("sha256").update(bytes).digest("hex"));
export const ReleaseManifest = z.strictObject({
  id: IdSchema, version: z.string().regex(/^\d+\.\d+\.\d+$/),
  sequence: z.number().int().positive(), security: z.boolean(), notes: z.string().max(100_000),
  expiresAt: InstantSchema, compatibleSchema: z.array(z.number().int().nonnegative()).min(1).readonly(),
  packageUrl: z.url(), packageDigest: DigestSchema,
  packageBytes: z.number().int().positive().max(268_435_456),
}).readonly();
export type SignedRelease = z.infer<typeof ReleaseManifest> & { readonly manifestDigest: Digest };
export const Envelope = z.strictObject({
  payload: z.base64().max(4_000_000), signature: z.base64().max(128),
});
export const Feed = z.strictObject({
  expiresAt: InstantSchema, releases: z.array(ReleaseManifest).max(500),
});
export const Package = z.strictObject({
  format: z.literal(1), entrypoint: z.string(),
  files: z.array(z.strictObject({
    path: z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_.-]+)*$/),
    data: z.base64(), executable: z.boolean(),
  }).readonly()).min(1).max(10_000).readonly(),
}).readonly();
export type ReleasePackage = z.infer<typeof Package>;
export const BackupReceipt = z.strictObject({
  id: z.string().min(1), manifestDigest: DigestSchema, verifiedAt: InstantSchema,
}).readonly();
export type BackupReceipt = z.infer<typeof BackupReceipt>;
/**
 * A reported helper failure, not a rejected/lost invocation. The controller
 * checks this evidence against its persisted exited execution before recording
 * a failed intent or attempting automatic rollback.
 */
export class ReportedUpdateFailure extends UpdateError {
  constructor(code: string, readonly evidence: MigrationEvidence) { super(code); }
}
export const UpdateConfig = z.strictObject({
  feedUrl: z.url(), trustKeyPem: z.string().min(1),
  installRoot: z.string().startsWith("/"), installId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  currentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  currentSequence: z.number().int().nonnegative(), schemaVersion: z.number().int().nonnegative(),
  window: z.strictObject({ start: InstantSchema, end: InstantSchema }),
  allowLoopbackHttp: z.boolean().default(false),
}).readonly();
export type UpdateConfig = z.infer<typeof UpdateConfig>;
export function assertWindow(config: UpdateConfig, at: string): void {
  const time = Date.parse(at);
  if (time < Date.parse(config.window.start) || time >= Date.parse(config.window.end)) {
    throw new UpdateError("OUTSIDE_MAINTENANCE_WINDOW");
  }
}
export function newerVersion(next: string, current: string): boolean {
  const left = next.split(".").map(BigInt);
  const right = current.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    const a = left[i]; const b = right[i];
    if (a === undefined || b === undefined) throw new UpdateError("INVALID_VERSION");
    if (a !== b) return a > b;
  }
  return false;
}
