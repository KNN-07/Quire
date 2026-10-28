import { z } from "zod";
import type { Clock, SqlExecutor, UnitOfWork } from "@quire/contracts";
import { DigestSchema } from "@quire/contracts";
import type { ControlStore } from "../installation/control-store";
import {
  LegacyRowsSchema, LegacySnapshotSchema,
} from "../installation/legacy-import";
import type {
  LegacyCopyCheckpoint, LegacyImportSource, LegacyRemovalResult, LegacySnapshot,
} from "../installation/legacy-import";
import { LegacyReleaseSchema } from "../installation/legacy-import";
import { ReservedUpdateCommandSchema } from "../installation/model";
import { canonicalJson, controlDigest, requestDigest } from "../installation/protocol";
import { reserveCommand } from "./commands";
import { UpdateError } from "./model";

const Tombstone = z.object({
  source_id: z.string(), digest: DigestSchema, snapshot_bytes: z.string(), receipt_bytes: z.string(),
});
export interface LegacySourceIdentity {
  readonly sourceId: string;
  readonly installationId: string;
  readonly dataIdentity: string;
}

/**
 * Only for an operator-stopped bootstrap. The host supplies the verified source
 * identity and keeps all application writers stopped through copy and removal.
 */
export class ApplicationLegacySource implements LegacyImportSource {
  constructor(readonly uow: UnitOfWork, readonly identity: LegacySourceIdentity) {}

  private assertIdentity(snapshot: LegacySnapshot): void {
    if (snapshot.sourceId !== this.identity.sourceId || snapshot.installationId !== this.identity.installationId ||
        snapshot.dataIdentity !== this.identity.dataIdentity) throw new UpdateError("LEGACY_SOURCE_MISMATCH");
  }
  private async tombstone(db: SqlExecutor) {
    return Tombstone.nullable().parse(await db.get(
      "SELECT * FROM o_update_legacy_removals WHERE source_id=?", [this.identity.sourceId],
    ));
  }
  private async read(db: SqlExecutor): Promise<LegacySnapshot> {
    const rows = LegacyRowsSchema.parse({
      jobs: await db.all("SELECT * FROM update_jobs ORDER BY operation_id"),
      operations: await db.all("SELECT * FROM operations WHERE kind='update' ORDER BY id"),
      floors: await db.all("SELECT * FROM update_install_state ORDER BY install_id"),
    });
    const ledger = z.array(z.object({ id: z.string(), digest: z.string(), applied_at: z.string() })).parse(
      await db.all("SELECT id,digest,applied_at FROM schema_migrations ORDER BY id"),
    );
    return LegacySnapshotSchema.parse({
      ...this.identity, migrationLedgerBytes: JSON.stringify(ledger), rowsBytes: JSON.stringify(rows),
    });
  }
  snapshot(): Promise<LegacySnapshot> {
    return this.uow.run(async tx => {
      await tx.lock(`o-update-legacy:${this.identity.sourceId}`);
      const removed = await this.tombstone(tx);
      if (removed === null) return this.read(tx);
      if (controlDigest(removed.snapshot_bytes) !== removed.digest) throw new UpdateError("LEGACY_CHECKPOINT_INVALID");
      const original = LegacySnapshotSchema.parse(JSON.parse(removed.snapshot_bytes));
      this.assertIdentity(original);
      if (removed.receipt_bytes !== canonicalJson({
        sourceId: original.sourceId, digest: removed.digest, dataIdentity: original.dataIdentity,
      })) throw new UpdateError("LEGACY_CHECKPOINT_INVALID");
      return original;
    });
  }
  removeCopied(checkpoint: LegacyCopyCheckpoint): Promise<LegacyRemovalResult> {
    const original = LegacySnapshotSchema.parse(JSON.parse(checkpoint.snapshotBytes));
    this.assertIdentity(original);
    if (checkpoint.sourceId !== original.sourceId || controlDigest(checkpoint.snapshotBytes) !== checkpoint.digest) {
      throw new UpdateError("LEGACY_CHECKPOINT_INVALID");
    }
    return this.uow.run(async tx => {
      await tx.lock(`o-update-legacy:${this.identity.sourceId}`);
      const removed = await this.tombstone(tx);
      if (removed !== null) {
        if (removed.digest !== checkpoint.digest || removed.snapshot_bytes !== checkpoint.snapshotBytes) {
          throw new UpdateError("LEGACY_CHECKPOINT_INVALID");
        }
        if (removed.receipt_bytes !== canonicalJson({
          sourceId: original.sourceId, digest: removed.digest, dataIdentity: original.dataIdentity,
        })) throw new UpdateError("LEGACY_CHECKPOINT_INVALID");
        return { sourceId: original.sourceId, digest: removed.digest, receiptBytes: removed.receipt_bytes };
      }
      if (JSON.stringify(await this.read(tx)) !== checkpoint.snapshotBytes) throw new UpdateError("LEGACY_SOURCE_CHANGED");
      const rows = LegacyRowsSchema.parse(JSON.parse(original.rowsBytes));
      for (const job of rows.jobs) await tx.run("DELETE FROM update_jobs WHERE operation_id=?", [job.operation_id]);
      for (const row of rows.operations) await tx.run("DELETE FROM operations WHERE id=?", [row.id]);
      for (const row of rows.floors) await tx.run("DELETE FROM update_install_state WHERE install_id=?", [row.install_id]);
      for (const row of [...rows.operations].sort((a, b) =>
        `${a.actor_id}:${a.idempotency_key}`.localeCompare(`${b.actor_id}:${b.idempotency_key}`))) {
        const job = rows.jobs.find(value => value.operation_id === row.id);
        if (job === undefined) throw new UpdateError("LEGACY_SOURCE_INCOMPLETE");
        const release = LegacyReleaseSchema.parse(JSON.parse(job.release_json));
        const request = { releaseId: release.id, at: job.scheduled_at, autoSecurity: Boolean(job.security_only) };
        const command = ReservedUpdateCommandSchema.parse({
          installationId: original.installationId, actorId: row.actor_id, operationId: row.id,
          key: row.idempotency_key, requestDigest: requestDigest(request), request,
        });
        if ((await reserveCommand(tx, command)).operationId !== row.id) throw new UpdateError("IDEMPOTENCY_CONFLICT");
      }
      const receiptBytes = canonicalJson({ sourceId: original.sourceId, digest: checkpoint.digest, dataIdentity: original.dataIdentity });
      await tx.run(`INSERT INTO o_update_legacy_removals(source_id,digest,snapshot_bytes,receipt_bytes) VALUES(?,?,?,?)`,
        [original.sourceId, checkpoint.digest, checkpoint.snapshotBytes, receiptBytes]);
      return { sourceId: original.sourceId, digest: checkpoint.digest, receiptBytes };
    });
  }
}

export async function importLegacyUpdates(source: LegacyImportSource, control: ControlStore, clock: Clock): Promise<LegacyCopyCheckpoint> {
  const copied = control.copyLegacy(await source.snapshot(), clock.now());
  return control.confirmLegacyRemoval(await source.removeCopied(copied), clock.now());
}
