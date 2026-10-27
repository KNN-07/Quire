import { z } from "zod";
import { HistoryVersionSchema, IdSchema, ThreadSchema, SuggestionSchema, AnchorSchema } from "@quire/contracts";
import type { Id, Scope, Snapshot } from "@quire/contracts";
import type { RequestContext } from "@quire/runtime";
import { ReviewMutations } from "./mutations";
import { fail, uuid } from "./store";
import * as Y from "yjs";

export const anchorPosition = z.object({ anchor: AnchorSchema, start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
export const reviewSnapshot = z.object({ threads: z.array(ThreadSchema), suggestions: z.array(SuggestionSchema),
  positions: z.array(anchorPosition) });
export class HistoryStore extends ReviewMutations {
  override async write(request: RequestContext, scope: Scope, action: string): Promise<Id> {
    const actor = await super.write(request, scope, action);
    // Capture imported/seeded checkpoints before the first review mutation can attach
    // newer metadata to an older source revision.
    this.captureMissing(scope.projectId);
    return actor;
  }
  capture(snapshot: Snapshot): void {
    if (this.context.db.query("SELECT 1 FROM history_versions WHERE snapshot_id=?").get(snapshot.id)) return;
    const threads = this.context.db.query<{ id: Id }, [string, string]>("SELECT id FROM threads WHERE project_id=? AND branch=?")
      .all(snapshot.scope.projectId, snapshot.scope.branch).map(row => this.threadDto(row.id, snapshot.scope.projectId));
    const suggestions = this.context.db.query<{ id: Id }, [string, string]>("SELECT id FROM suggestions WHERE project_id=? AND branch=?")
      .all(snapshot.scope.projectId, snapshot.scope.branch).map(row => this.suggestion(row.id, snapshot.scope.projectId).dto);
    const positions = [...threads.flatMap(thread => thread.anchor ? [thread.anchor] : []),
      ...suggestions.flatMap(suggestion => suggestion.edits.map(edit => edit.anchor))].flatMap(anchor => {
      if (!this.projects.listFiles(snapshot.scope).some(file => file.id === anchor.fileId && file.editable)) return [];
      const document = this.projects.loadDocument(snapshot.scope, anchor.fileId);
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
    });
    this.context.uow.local(tx => {
      tx.query(`INSERT INTO history_versions(id,snapshot_id,review_snapshot_id,review_json,authors_json,created_at)
        VALUES(?,?,?,?,?,?)`).run(snapshot.id, snapshot.id, uuid(), JSON.stringify({ threads, suggestions, positions }),
          JSON.stringify([snapshot.authorId]), snapshot.createdAt);
      this.context.events.append(tx, { topic: "history.created", aggregateId: snapshot.scope.projectId,
        payload: { resourceId: snapshot.id, version: snapshot.revision } });
    });
  }
  captureMissing(projectId?: Id): void {
    const rows = projectId
      ? this.context.db.query<{ id: Id }, [string]>(`SELECT s.id FROM snapshots s LEFT JOIN history_versions h
        ON h.snapshot_id=s.id WHERE h.id IS NULL AND s.project_id=? ORDER BY s.rowid`).all(projectId)
      : this.context.db.query<{ id: Id }, []>(`SELECT s.id FROM snapshots s LEFT JOIN history_versions h
        ON h.snapshot_id=s.id WHERE h.id IS NULL ORDER BY s.rowid`).all();
    for (const row of rows) this.capture(this.projects.getSnapshot(row.id));
  }
  record(id: Id, projectId: Id) {
    const value = historyRow.parse(this.context.db.query(`SELECT h.* FROM history_versions h
      JOIN snapshots s ON s.id=h.snapshot_id WHERE h.id=? AND s.project_id=?`).get(id, projectId)
      ?? fail("NOT_FOUND", 404, "History version not found"));
    return { ...value, snapshot: this.projects.getSnapshot(value.snapshot_id) };
  }
  async dto(id: Id, scope: Scope, actorId: Id | null) {
    const row = this.record(id, scope.projectId);
    if (row.snapshot.scope.branch !== scope.branch) fail("NOT_FOUND", 404, "History is not on this branch");
    const policy = await this.projects.policy(actorId ?? this.projects.getProject(scope.projectId).ownerId, scope.projectId);
    const age = Date.parse(this.context.clock.now()) - Date.parse(row.created_at);
    const accessible = policy.historyDays === null || age <= policy.historyDays * 86400000;
    const labels = this.context.db.query("SELECT id,name FROM version_labels WHERE history_version_id=? ORDER BY created_at,id").all(id);
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
