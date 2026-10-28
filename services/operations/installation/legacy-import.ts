import { z } from "zod";
import { IdSchema, InstantSchema, OperationSchema } from "@quire/contracts";
import type { Digest, Instant } from "@quire/contracts";
import { AcceptedReleaseSchema, InstallationIdSchema, PhaseSchema } from "./model";

export const LegacyRowsSchema = z.strictObject({
  jobs: z.array(z.strictObject({
    operation_id: IdSchema, release_json: z.string(), scheduled_at: InstantSchema,
    security_only: z.union([z.literal(0), z.literal(1)]), phase: PhaseSchema,
    prior_target: z.string().nullable(), staged_target: z.string().nullable(), backup_json: z.string().nullable(),
  })),
  operations: z.array(z.strictObject({
    id: IdSchema, actor_id: IdSchema, kind: z.literal("update"),
    status: OperationSchema.unwrap().shape.status,
    progress: z.number().min(0).max(1), result_json: z.string().nullable(),
    error_code: z.string().nullable(), idempotency_key: z.string().min(1),
    version: z.number().int().nonnegative(), created_at: InstantSchema, updated_at: InstantSchema,
  })),
  floors: z.array(z.strictObject({
    install_id: InstallationIdSchema, sequence: z.number().int().nonnegative(), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  })),
});
export const LegacySnapshotSchema = z.strictObject({
  sourceId: z.string().min(1), installationId: InstallationIdSchema,
  dataIdentity: z.string().min(1), migrationLedgerBytes: z.string(),
  rowsBytes: z.string(),
}).readonly();
export type LegacySnapshot = z.infer<typeof LegacySnapshotSchema>;
export const LegacyReleaseSchema = AcceptedReleaseSchema;
export interface LegacyCopyCheckpoint {
  readonly sourceId: string;
  readonly digest: Digest;
  readonly snapshotBytes: string;
  readonly copiedAt: Instant;
  readonly removedAt: Instant | null;
  readonly removalReceiptBytes: string | null;
}
export interface LegacyRemovalResult {
  readonly sourceId: string;
  readonly digest: Digest;
  /** Source-transaction tombstone, retained for a retry after source deletion. */
  readonly receiptBytes: string;
}
/**
 * Implemented by the application migration owner, not by control SQLite.
 * removeCopied must compare every original row/ledger byte and source identity,
 * reserve actor/key identities, delete only copied rows, and persist its removal
 * tombstone in ONE application transaction. A retry returns that tombstone;
 * an empty source without it is not evidence of completed removal.
 */
export interface LegacyImportSource {
  snapshot(): Promise<LegacySnapshot>;
  removeCopied(checkpoint: LegacyCopyCheckpoint): Promise<LegacyRemovalResult>;
}
