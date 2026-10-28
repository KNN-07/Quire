import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { policy } from "../../accounts/identity/policy";

type HistoryTarget = {
  readonly snapshotId: Id; readonly projectId: Id; readonly actorId: Id | null;
};
/** Foundation tables only: compiler-only compositions need no review registration. */
export async function historyAccessible(context: ModuleContext, target: HistoryTarget): Promise<boolean> {
  const row = z.object({ created_at: z.string(), labeled: z.number(), owner_id: IdSchema }).nullable().parse(
    await context.db.get(`SELECT COALESCE(h.created_at,s.created_at) AS created_at,p.owner_id,
      CASE WHEN EXISTS(SELECT 1 FROM version_labels l JOIN history_versions v ON v.id=l.history_version_id
        WHERE v.snapshot_id=s.id) THEN 1 ELSE 0 END AS labeled
      FROM snapshots s JOIN projects p ON p.id=s.project_id
      LEFT JOIN history_versions h ON h.snapshot_id=s.id
      WHERE s.id=? AND s.project_id=? AND p.deleted_at IS NULL`, [target.snapshotId, target.projectId]));
  if (!row) throw new ServiceError("NOT_FOUND", 404, "History snapshot not found");
  const current = await policy(context).forProject(target.actorId ?? row.owner_id, target.projectId);
  return row.labeled === 1 || current.historyDays === null ||
    Date.parse(context.clock.now()) - Date.parse(row.created_at) <= current.historyDays * 86400000;
}
export async function assertHistoryAccess(context: ModuleContext, target: HistoryTarget): Promise<void> {
  if (!await historyAccessible(context, target)) {
    throw new ServiceError("HISTORY_WINDOW", 403, "Version is outside the current history access window");
  }
}
