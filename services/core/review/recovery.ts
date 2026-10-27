import { z } from "zod";
import * as Y from "yjs";
import { AnchorSchema, ScopeSchema, IdSchema } from "@quire/contracts";
import type { Anchor, Scope } from "@quire/contracts";
import { reviewSnapshot } from "./history-store";
import type { HistoryStore, anchorPosition } from "./history-store";

export const restorePlan = z.object({ scope: ScopeSchema, historyId: IdSchema,
  fileIds: z.array(IdSchema).nullable(), expectedRevision: z.number(), actorId: IdSchema,
  key: z.string(), route: z.string(), digest: z.string() });
export type RestorePlan = z.infer<typeof restorePlan>;
export function reanchor(store: HistoryStore, scope: Scope, position: z.infer<typeof anchorPosition>): Anchor | null {
  const { anchor, start, end } = position;
  const file = store.projects.listFiles(scope).find(entry => entry.id === anchor.fileId && entry.editable);
  if (!file) return null;
  const source = store.projects.loadDocument(scope, file.id);
  if (source.text.slice(start, end) !== anchor.quote || end > source.text.length) return null;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(source.state, "base64"));
    const text = doc.getText("source");
    return AnchorSchema.parse({ ...anchor, epoch: source.epoch,
      startRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start))).toString("base64"),
      endRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, end))).toString("base64") });
  } finally { doc.destroy(); }
}
export function recoverReview(store: HistoryStore, plan: RestorePlan): void {
  const context = store.context;
  const prior = reviewSnapshot.parse(JSON.parse(store.record(plan.historyId, plan.scope.projectId).review_json));
  const eligible = (anchor: Anchor | null) => plan.fileIds === null || (anchor !== null && plan.fileIds.includes(anchor.fileId));
  for (const thread of prior.threads) {
    if (!eligible(thread.anchor)) continue;
    const position = prior.positions.find(item => JSON.stringify(item.anchor) === JSON.stringify(thread.anchor));
    const anchor = position ? reanchor(store, plan.scope, position) : null;
    if (thread.anchor && !anchor) continue;
    const comments = thread.comments.filter(comment => !context.db.query(
      "SELECT 1 FROM permanent_comment_tombstones WHERE comment_id=?").get(comment.id));
    if (!comments.length) continue;
    context.db.query(`INSERT INTO threads(id,project_id,branch,anchor_json,resolved,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET anchor_json=excluded.anchor_json,
      resolved=excluded.resolved,version=version+1`).run(thread.id, plan.scope.projectId, plan.scope.branch,
        anchor ? JSON.stringify(anchor) : null, Number(thread.resolved), context.clock.now());
    for (const comment of comments) context.db.query(`INSERT INTO comments(id,thread_id,author_id,body,created_at,edited_at,version)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(comment.id, thread.id, comment.authorId,
        comment.body, comment.createdAt, comment.editedAt, comment.version);
  }
  for (const suggestion of prior.suggestions) {
    const edits = suggestion.edits.filter(edit => eligible(edit.anchor) && edit.status === "pending")
      .map(edit => {
        const position = prior.positions.find(item => JSON.stringify(item.anchor) === JSON.stringify(edit.anchor));
        return { edit, anchor: position ? reanchor(store, plan.scope, position) : null };
      }).filter(item => item.anchor !== null);
    if (!edits.length) continue;
    context.db.query(`INSERT INTO suggestions(id,project_id,branch,author_id,origin,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(suggestion.id, plan.scope.projectId, plan.scope.branch,
        suggestion.authorId, suggestion.origin, suggestion.createdAt);
    for (const { edit, anchor } of edits) context.db.query(`INSERT INTO suggestion_edits
      (id,suggestion_id,file_id,anchor_json,before_text,after_text,base_revision,status)
      VALUES(?,?,?,?,?,?,?,'pending') ON CONFLICT(id) DO NOTHING`).run(edit.id, suggestion.id,
        edit.fileId, JSON.stringify(anchor), edit.before, edit.after, store.projects.getBranch(plan.scope).revision);
  }
  context.db.query("DELETE FROM review_restore_intents WHERE id=?").run(`${plan.actorId}:${plan.route}:${plan.key}`);
  store.changed(plan.scope);
}
export function finishRestores(store: HistoryStore): void {
  const rows = store.context.db.query<{ payload_json: string }, []>("SELECT payload_json FROM review_restore_intents").all();
  for (const row of rows) {
    const plan = restorePlan.parse(JSON.parse(row.payload_json));
    const receipt = store.context.db.query("SELECT 1 FROM idempotency_results WHERE actor_id=? AND key=? AND route=?")
      .get(plan.actorId, plan.key, plan.route);
    if (receipt) store.context.uow.local(() => recoverReview(store, plan));
  }
}
export const migrations = [{ id: "023-k-review-history", sql: `
ALTER TABLE history_versions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX review_snapshot_once ON history_versions(snapshot_id);
CREATE TABLE review_restore_intents(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL) STRICT;
CREATE TABLE review_decision_intents(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL) STRICT;
` }] as const;
