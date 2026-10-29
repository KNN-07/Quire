import { endpoints } from "@quire/contracts";
import type { HistoryChanges, Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { AccessStore } from "../base/access";
import type { HistoryStore } from "./history-store";
import { fail } from "./store";

export function registerHistoryChanges(context: ModuleContext, store: HistoryStore): void {
  context.routes.register(endpoints.historyChanges, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    const actorId = await store.read(request, scope);
    await store.captureMissing(scope.projectId);
    await store.accessible(input.query.from, scope, actorId);
    await store.accessible(input.query.to, scope, actorId);
    // Revisions order source mutations; history_order distinguishes same-revision checkpoints.
    const rows = await context.db.all<{ id: Id }>(`SELECT h.id FROM history_versions h
      JOIN snapshots s ON s.id=h.snapshot_id WHERE s.project_id=? AND s.branch=?
      ORDER BY s.revision,h.history_order`, [scope.projectId, scope.branch]);
    const start = rows.findIndex(row => row.id === input.query.from);
    const end = rows.findIndex(row => row.id === input.query.to);
    if (start < 0 || end < start) fail("HISTORY_RANGE", 422, "Choose history versions in chronological order");
    const range = rows.slice(start, end + 1);
    // Do not bridge hidden transitions, even when both endpoints have retained labels.
    const versions = [];
    for (const row of range) versions.push(await store.accessible(row.id, scope, actorId));
    const changes: HistoryChanges["changes"][number][] = [];
    let previous = versions[0];
    if (!previous) fail("NOT_FOUND", 404, "History version not found");
    let left = (await store.projects.readSnapshot(previous.snapshot.id)).files;
    for (const next of versions.slice(1)) {
      const right = (await store.projects.readSnapshot(next.snapshot.id)).files;
      const beforeFiles = new Map(left.map(file => [file.id, file]));
      const afterFiles = new Map(right.map(file => [file.id, file]));
      for (const fileId of new Set([...beforeFiles.keys(), ...afterFiles.keys()])) {
        if (input.query.fileId && input.query.fileId !== fileId) continue;
        const before = beforeFiles.get(fileId);
        const after = afterFiles.get(fileId);
        if (before?.blob === after?.blob && before?.path === after?.path) continue;
        const file = after ?? before;
        if (!file) continue;
        changes.push({
          id: `${previous.id}:${next.id}:${fileId}`, fromVersionId: previous.id, toVersionId: next.id,
          fromRevision: previous.snapshot.revision, toRevision: next.snapshot.revision,
          fileId, path: file.path, beforePath: before?.path ?? null, afterPath: after?.path ?? null,
          actorId: next.snapshot.authorId, granularity: "recorded-file-transition",
          reason: next.snapshot.reason, createdAt: next.snapshot.createdAt,
          before: before?.editable && before.blob ? new TextDecoder().decode(await context.blobs.get(before.blob)) : null,
          after: after?.editable && after.blob ? new TextDecoder().decode(await context.blobs.get(after.blob)) : null,
        });
      }
      previous = next;
      left = right;
    }
    return context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const bound = store.withTransaction(tx);
      await new AccessStore(bound.context).authorizeRead(request.request, scope, actorId);
      for (const row of range) await bound.accessible(row.id, scope, actorId);
      const participants = [];
      for (const id of new Set(changes.map(change => change.actorId))) {
        const user = await tx.get<{ name: string }>("SELECT name FROM users WHERE id=? AND deleted_at IS NULL", [id]);
        participants.push({ id, displayName: user?.name ?? null });
      }
      return { scope, fromVersionId: input.query.from, toVersionId: input.query.to, participants, changes };
    });
  });
}
