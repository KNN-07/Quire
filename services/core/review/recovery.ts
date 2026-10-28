import { z } from "zod";
import * as Y from "yjs";
import { AnchorSchema, ScopeSchema, IdSchema } from "@quire/contracts";
import type { Anchor, Scope, BranchLease } from "@quire/contracts";
import { reviewSnapshot } from "./history-store";
import type { HistoryStore, anchorPosition } from "./history-store";

export const restorePlan = z.object({ scope: ScopeSchema, historyId: IdSchema,
  fileIds: z.array(IdSchema).nullable(), expectedRevision: z.number(), actorId: IdSchema,
  key: z.string(), route: z.string(), digest: z.string() });
export type RestorePlan = z.infer<typeof restorePlan>;
export async function reanchor(store: HistoryStore, scope: Scope, position: z.infer<typeof anchorPosition>): Promise<Anchor | null> {
  const { anchor, start, end } = position;
  const file = (await store.projects.listFiles(scope)).find(entry => entry.id === anchor.fileId && entry.editable);
  if (!file) return null;
  const source = (await store.projects.loadDocument(scope, file.id));
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
export async function recoverReview(store: HistoryStore, plan: RestorePlan): Promise<void> {
  const context = store.context;
  const prior = reviewSnapshot.parse(JSON.parse((await store.record(plan.historyId, plan.scope.projectId)).review_json));
  const eligible = (anchor: Anchor | null) => plan.fileIds === null || (anchor !== null && plan.fileIds.includes(anchor.fileId));
  for (const thread of prior.threads) {
    if (!eligible(thread.anchor)) continue;
    const position = prior.positions.find(item => JSON.stringify(item.anchor) === JSON.stringify(thread.anchor));
    const anchor = position ? (await reanchor(store, plan.scope, position)) : null;
    if (thread.anchor && !anchor) continue;
    const comments = [];
    for (const comment of thread.comments) if (!await context.db.get("SELECT 1 FROM permanent_comment_tombstones WHERE comment_id=?", [comment.id])) comments.push(comment);
    if (!comments.length) continue;
    (await context.db.run(`INSERT INTO threads(id,project_id,branch,anchor_json,resolved,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET anchor_json=excluded.anchor_json,
      resolved=excluded.resolved,version=threads.version+1`, [thread.id, plan.scope.projectId, plan.scope.branch, anchor ? JSON.stringify(anchor) : null, Number(thread.resolved), context.clock.now()]));
    for (const comment of comments) (await context.db.run(`INSERT INTO comments(id,thread_id,author_id,body,created_at,edited_at,version)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, [comment.id, thread.id, comment.authorId, comment.body, comment.createdAt, comment.editedAt, comment.version]));
  }
  for (const suggestion of prior.suggestions) {
    const edits = (await Promise.all(suggestion.edits.filter(edit => eligible(edit.anchor) && edit.status === "pending")
      .map(async edit => {
        const position = prior.positions.find(item => JSON.stringify(item.anchor) === JSON.stringify(edit.anchor));
        return { edit, anchor: position ? (await reanchor(store, plan.scope, position)) : null };
      }))).filter(item => item.anchor !== null);
    if (!edits.length) continue;
    (await context.db.run(`INSERT INTO suggestions(id,project_id,branch,author_id,origin,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, [suggestion.id, plan.scope.projectId, plan.scope.branch, suggestion.authorId, suggestion.origin, suggestion.createdAt]));
    for (const [editOrder, { edit, anchor }] of edits.entries()) (await context.db.run(`INSERT INTO suggestion_edits
      (id,suggestion_id,file_id,anchor_json,before_text,after_text,base_revision,status,edit_order)
      VALUES(?,?,?,?,?,?,?,'pending',?) ON CONFLICT(id) DO NOTHING`, [edit.id, suggestion.id, edit.fileId, JSON.stringify(anchor), edit.before, edit.after, (await store.projects.getBranch(plan.scope)).revision, editOrder]));
  }
  (await context.db.run("DELETE FROM review_restore_intents WHERE id=?", [`${plan.actorId}:${plan.route}:${plan.key}`]));
  (await store.changed(plan.scope));
}
export async function finishRestores(store: HistoryStore, currentLease?: BranchLease): Promise<void> {
  const rows = (await store.context.db.all<{ payload_json: string }>("SELECT payload_json FROM review_restore_intents", []));
  for (const row of rows) {
    const plan = restorePlan.parse(JSON.parse(row.payload_json));
    const receipt = (await store.context.db.get("SELECT 1 FROM idempotency_results WHERE actor_id=? AND key=? AND route=?", [plan.actorId, plan.key, plan.route]));
    if (!receipt) continue;
    const finish = async (lease: BranchLease) => store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await store.context.branches.assert(tx, lease);
      await tx.lock("quire:review-history");
      if (await tx.get("SELECT 1 FROM review_restore_intents WHERE id=?", [`${plan.actorId}:${plan.route}:${plan.key}`])) await recoverReview(store.withTransaction(tx), plan);
    });
    if (currentLease?.scope.projectId === plan.scope.projectId && currentLease.scope.branch === plan.scope.branch) await finish(currentLease);
    else await store.projects.serialized(plan.scope, finish);
  }
}
export const migrations = [{ id: "023-k-review-history", postgres: `
ALTER TABLE history_versions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX review_snapshot_once ON history_versions(snapshot_id);
CREATE TABLE review_restore_intents(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL);
CREATE TABLE review_decision_intents(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL);
`, sql: `
ALTER TABLE history_versions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX review_snapshot_once ON history_versions(snapshot_id);
CREATE TABLE review_restore_intents(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL) STRICT;
CREATE TABLE review_decision_intents(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL) STRICT;
` }, { id: "023-k-review-portable", sql: `
ALTER TABLE history_versions ADD COLUMN history_order INTEGER NOT NULL DEFAULT 0;
UPDATE history_versions SET history_order=(SELECT rowid FROM snapshots WHERE snapshots.id=history_versions.snapshot_id);
CREATE UNIQUE INDEX review_history_order ON history_versions(history_order);
`, postgres: `
ALTER TABLE history_versions ADD COLUMN history_order BIGINT NOT NULL DEFAULT 0;
WITH ranked AS (SELECT h.id,ROW_NUMBER() OVER (ORDER BY s.created_at,s.revision,s.id) AS n
  FROM history_versions h JOIN snapshots s ON s.id=h.snapshot_id)
UPDATE history_versions SET history_order=ranked.n FROM ranked WHERE history_versions.id=ranked.id;
CREATE UNIQUE INDEX review_history_order ON history_versions(history_order);
` }] as const;
