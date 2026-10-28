import { z } from "zod";
import { HistoryVersionSchema, IdSchema, ThreadSchema, SuggestionSchema, AnchorSchema } from "@quire/contracts";
import type { Id, Scope, Snapshot } from "@quire/contracts";
import type { RequestContext, Transaction } from "@quire/runtime";
import { ReviewMutations } from "./mutations";
import { fail, uuid } from "./store";
import * as Y from "yjs";
import { historyAccessible } from "../base/history-access";

export const anchorPosition = z.object({ anchor: AnchorSchema, start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
export const reviewSnapshot = z.object({ threads: z.array(ThreadSchema), suggestions: z.array(SuggestionSchema),
  positions: z.array(anchorPosition) });
export class HistoryStore extends ReviewMutations {
  override withTransaction(tx: Transaction): HistoryStore {
    return new HistoryStore({ ...this.context, db: tx }, this.projects.withTransaction(tx));
  }
  override async write(request: RequestContext, scope: Scope, action: string): Promise<Id> {
    const actor = await super.write(request, scope, action);
    // Capture imported/seeded checkpoints before the first review mutation can attach
    // newer metadata to an older source revision.
    (await this.captureMissing(scope.projectId));
    return actor;
  }
  async capture(snapshot: Snapshot): Promise<void> {
    await this.context.uow.run(async tx => {
      await tx.lock("quire:review-history");
      await this.withTransaction(tx).captureInside(snapshot);
    });
  }
  private async captureInside(snapshot: Snapshot): Promise<void> {
    if ((await this.context.db.get("SELECT 1 FROM history_versions WHERE snapshot_id=?", [snapshot.id]))) return;
    const threads = (await Promise.all((await this.context.db.all<{ id: Id }>("SELECT id FROM threads WHERE project_id=? AND branch=?", [snapshot.scope.projectId, snapshot.scope.branch])).map(async row => (await this.threadDto(row.id, snapshot.scope.projectId)))));
    const suggestions = (await Promise.all((await this.context.db.all<{ id: Id }>("SELECT id FROM suggestions WHERE project_id=? AND branch=?", [snapshot.scope.projectId, snapshot.scope.branch])).map(async row => (await this.suggestion(row.id, snapshot.scope.projectId)).dto)));
    const positions = (await Promise.all([...threads.flatMap(thread => thread.anchor ? [thread.anchor] : []),
      ...suggestions.flatMap(suggestion => suggestion.edits.map(edit => edit.anchor))].map(async anchor => {
      if (!(await this.projects.listFiles(snapshot.scope)).some(file => file.id === anchor.fileId && file.editable)) return [];
      const document = (await this.projects.loadDocument(snapshot.scope, anchor.fileId));
      if (document.epoch !== anchor.epoch) return [];
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, Buffer.from(document.state, "base64"));
        const text = doc.getText("source");
        const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(anchor.startRelative, "base64")), doc);
        const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(anchor.endRelative, "base64")), doc);
        return start && end && start.type === text && end.type === text && start.index <= end.index
          ? [{ anchor, start: start.index, end: end.index }] : [];
      } finally { doc.destroy(); }
    }))).flat();
    const tx = this.transaction;
    const order = z.object({ n: z.number() }).parse(await tx.get("SELECT COALESCE(MAX(history_order),0)+1 AS n FROM history_versions")).n;
      (await tx.run(`INSERT INTO history_versions(id,snapshot_id,review_snapshot_id,review_json,authors_json,created_at,history_order)
        VALUES(?,?,?,?,?,?,?)`, [snapshot.id, snapshot.id, uuid(), JSON.stringify({ threads, suggestions, positions }), JSON.stringify([snapshot.authorId]), snapshot.createdAt, order]));
      await this.context.events.record(tx, { topic: "history.created", aggregateId: snapshot.scope.projectId,
        payload: { resourceId: snapshot.id, version: snapshot.revision } });
  }
  async captureMissing(projectId?: Id): Promise<void> {
    const rows = projectId
      ? (await this.context.db.all<{ id: Id }>(`SELECT s.id FROM snapshots s LEFT JOIN history_versions h
        ON h.snapshot_id=s.id WHERE h.id IS NULL AND s.project_id=? ORDER BY s.created_at,s.revision,s.id`, [projectId]))
      : (await this.context.db.all<{ id: Id }>(`SELECT s.id FROM snapshots s LEFT JOIN history_versions h
        ON h.snapshot_id=s.id WHERE h.id IS NULL ORDER BY s.created_at,s.revision,s.id`, []));
    for (const row of rows) (await this.capture((await this.projects.getSnapshot(row.id))));
  }
  async record(id: Id, projectId: Id) {
    const value = historyRow.parse((await this.context.db.get(`SELECT h.* FROM history_versions h
      JOIN snapshots s ON s.id=h.snapshot_id WHERE h.id=? AND s.project_id=?`, [id, projectId]))
      ?? fail("NOT_FOUND", 404, "History version not found"));
    return { ...value, snapshot: (await this.projects.getSnapshot(value.snapshot_id)) };
  }
  async dto(id: Id, scope: Scope, actorId: Id | null) {
    const row = (await this.record(id, scope.projectId));
    if (row.snapshot.scope.branch !== scope.branch) fail("NOT_FOUND", 404, "History is not on this branch");
    const labels = (await this.context.db.all("SELECT id,name FROM version_labels WHERE history_version_id=? ORDER BY created_at,id", [id]));
    const accessible = await historyAccessible(this.context, { snapshotId: row.snapshot.id, projectId: scope.projectId, actorId });
    return HistoryVersionSchema.parse({ id, snapshot: row.snapshot, version: row.version, labels, authors: JSON.parse(row.authors_json),
      reviewSnapshotId: row.review_snapshot_id, accessible });
  }
  async accessible(id: Id, scope: Scope, actorId: Id | null) {
    const dto = await this.dto(id, scope, actorId);
    if (!dto.accessible) fail("HISTORY_WINDOW", 403, "Version is outside the current history access window");
    return dto;
  }
}
const historyRow = z.object({ id: IdSchema, snapshot_id: IdSchema, review_snapshot_id: IdSchema,
  review_json: z.string(), authors_json: z.string(), created_at: z.string(), version: z.number() });
