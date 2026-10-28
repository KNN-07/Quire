import { z } from "zod";
import { rm } from "node:fs/promises";
import type { ModuleContext } from "@quire/runtime";
import { BackupError, backupHost } from "./model";
import { ownedPath } from "./files";
import { verifyBackup } from "./archive";

export const policySchema = z.strictObject({
  schedule: z.string(), retentionDays: z.number().int().min(1).max(36500),
  destination: z.string(), version: z.number().int().nonnegative(),
}).readonly();
export type Policy = z.infer<typeof policySchema>;
/** Supported UTC schedules are disabled or a daily minute/hour cron, never local time. */
export function scheduleSlot(schedule: string, now: string): string | null {
  if (schedule === "disabled") return null;
  const match = /^(0|[1-5]?\d) (0|1?\d|2[0-3]) \* \* \*$/.exec(schedule);
  if (!match) throw new BackupError("BACKUP_SCHEDULE_INVALID", "Use 'disabled' or 'minute hour * * *' in UTC");
  const time = new Date(now);
  const due = new Date(time);
  due.setUTCHours(Number(match[2]), Number(match[1]), 0, 0);
  if (due.getTime() > time.getTime()) due.setUTCDate(due.getUTCDate() - 1);
  return due.toISOString();
}
export async function getPolicy(context: ModuleContext): Promise<Policy> {
  const row = await context.db.get("SELECT schedule,retention_days AS \"retentionDays\",destination,version FROM o_backup_schedule WHERE singleton=1");
  return policySchema.parse(row ?? { schedule: "disabled", retentionDays: 30,
    destination: backupHost(context).backupRoot, version: 0 });
}
export async function putPolicy(context: ModuleContext, input: {
  readonly schedule: string; readonly retentionDays: number; readonly destination: string; readonly expectedVersion: number;
}): Promise<{ readonly ok: true; readonly version: number }> {
  const policy = policySchema.parse({ schedule: input.schedule, retentionDays: input.retentionDays,
    destination: input.destination, version: input.expectedVersion });
  scheduleSlot(policy.schedule, context.clock.now());
  if (policy.destination !== backupHost(context).backupRoot) {
    throw new BackupError("BACKUP_POLICY_INVALID", "Destination must be the operator-provisioned private backup root");
  }
  return context.uow.run(async tx => {
    await tx.lock("quire:backup-policy");
    const existing = await tx.get<{ version: number }>("SELECT version FROM o_backup_schedule WHERE singleton=1");
    if ((existing?.version ?? 0) !== policy.version) throw new BackupError("VERSION_CONFLICT", "Backup policy changed");
    const version = policy.version + 1;
    await tx.run(`INSERT INTO o_backup_schedule(singleton,schedule,retention_days,destination,version,last_slot)
      VALUES(1,?,?,?,?,NULL) ON CONFLICT(singleton) DO UPDATE SET schedule=excluded.schedule,
      retention_days=excluded.retention_days,destination=excluded.destination,version=excluded.version,last_slot=NULL`,
    [policy.schedule, policy.retentionDays, policy.destination, version]);
    return { ok: true, version };
  });
}
export async function retainBackups(context: ModuleContext): Promise<readonly string[]> {
  const policy = await getPolicy(context);
  const cutoff = new Date(Date.parse(context.clock.now()) - policy.retentionDays * 86400000).toISOString();
  const records = await context.db.query(
    "SELECT id,destination,manifest_digest FROM backups WHERE status='succeeded' AND verified_at IS NOT NULL AND created_at<? ORDER BY created_at,id",
    [cutoff], z.object({ id: z.string(), destination: z.string(), manifest_digest: z.string() }));
  const removed: string[] = [];
  for (const record of records) {
    const path = await ownedPath(backupHost(context).backupRoot, record.id);
    if (path !== record.destination) throw new BackupError("BACKUP_RETENTION_OWNERSHIP", record.id);
    const archive = await verifyBackup(path, context.secretKey, backupHost(context).signingKey);
    if (archive.manifest.id !== record.id || archive.manifestDigest !== record.manifest_digest) {
      throw new BackupError("BACKUP_RETENTION_OWNERSHIP", record.id);
    }
    await rm(path, { recursive: true });
    await context.db.run("UPDATE backups SET status='canceled' WHERE id=?", [record.id]);
    removed.push(record.id);
  }
  return removed;
}
