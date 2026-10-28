import { z } from "zod";
import * as Y from "yjs";
import { FileEntrySchema, SnapshotSchema, IdSchema, ScopeSchema } from "@quire/contracts";
import type { FileEntry, BranchLease } from "@quire/contracts";
import { referenceBlob } from "@quire/runtime";
import type { PendingEvent } from "@quire/runtime";
import { newId, compare, fail } from "./store";
import { AccessStore } from "./access";
import { sourceReceipt, httpSourceReceipt, saveReceipt, saveSourceHttpReceipt } from "./receipts";
import type { TransactionContext } from "./receipts";
import { sourceFinalization, applyFinalization } from "./source-finalization";
import { assertHistoryAccess } from "./history-access";

export const documentRecord = z.object({
  fileId: z.string(), docId: z.string(), text: z.string(), state: z.string(), vector: z.string(),
  revision: z.number(), epoch: z.number(),
});
export const sourceIntent = z.object({
  snapshot: SnapshotSchema, branchId: z.string(), previousRevision: z.number(),
  files: z.array(FileEntrySchema), documents: z.array(documentRecord), commit: z.string(),
  projectVersion: z.number().optional(),
  receipt: sourceReceipt.optional(),
  http: httpSourceReceipt.optional(),
  finalization: sourceFinalization.optional(),
  createBranch: z.literal(true).optional(),
});
export type SourceIntent = z.infer<typeof sourceIntent>;
export type SourceDocument = z.infer<typeof documentRecord>;
export type SourceInput = {
  readonly file: FileEntry;
  readonly bytes?: Uint8Array;
  readonly document?: Y.Doc;
};
export function materializeDocument(input: {
  readonly file: FileEntry; readonly text: string; readonly previous?: SourceDocument; readonly document?: Y.Doc;
}): SourceDocument {
  const doc = input.document ?? new Y.Doc();
  try {
    if (!input.document) {
      if (input.previous) Y.applyUpdate(doc, Buffer.from(input.previous.state, "base64"));
      const text = doc.getText("source");
      if (text.toJSON() !== input.text) {
        doc.transact(() => { text.delete(0, text.length); text.insert(0, input.text); });
      }
    }
    return {
      fileId: input.file.id, docId: input.previous?.docId ?? newId(), text: doc.getText("source").toJSON(),
      state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
      vector: Buffer.from(Y.encodeStateVector(doc)).toString("base64"),
      revision: input.file.version.revision, epoch: input.file.version.epoch,
    };
  } finally { if (!input.document) doc.destroy(); }
}
export async function validateSource(context: TransactionContext, intent: SourceIntent, lease: BranchLease): Promise<void> {
  await context.db.lock("quire:accounts");
  await context.branches.assert(context.db, lease);
  if (lease.scope.projectId !== intent.snapshot.scope.projectId || lease.scope.branch !== intent.snapshot.scope.branch) {
    fail("SOURCE_SCOPE_MISMATCH", 409, "Lease belongs to another branch");
  }
  const service = new AccessStore(context);
  await service.authorize(intent.snapshot.authorId, intent.snapshot.scope,
    intent.snapshot.revision === intent.previousRevision ? "snapshot" : "write");
  if (intent.receipt?.route.startsWith("historyRestore:")) {
    const receipt = intent.receipt;
    const value = await context.db.get<{ payload_json: string }>("SELECT payload_json FROM review_restore_intents WHERE id=?",
      [`${receipt.actorId}:${receipt.route}:${receipt.key}`]);
    if (!value) fail("RESTORE_INTENT_REQUIRED", 409, "Restore target is missing");
    const target = z.object({ scope: ScopeSchema, historyId: IdSchema, actorId: IdSchema,
      key: z.string(), route: z.string(), digest: z.string() }).parse(JSON.parse(value.payload_json));
    if (target.actorId !== receipt.actorId || target.key !== receipt.key || target.route !== receipt.route ||
      target.digest !== receipt.digest || receipt.actorId !== intent.snapshot.authorId ||
      target.scope.projectId !== intent.snapshot.scope.projectId || target.scope.branch !== intent.snapshot.scope.branch) {
      fail("SOURCE_SCOPE_MISMATCH", 409, "Restore target belongs to another source intent");
    }
    const history = z.object({ snapshot_id: IdSchema, branch: z.string() }).nullable().parse(
      await context.db.get(`SELECT h.snapshot_id,s.branch FROM history_versions h JOIN snapshots s ON s.id=h.snapshot_id
        WHERE h.id=? AND s.project_id=?`, [target.historyId, target.scope.projectId]));
    if (!history || history.branch !== target.scope.branch) fail("NOT_FOUND", 404, "Restore history is not on this branch");
    await assertHistoryAccess(context, { snapshotId: history.snapshot_id, projectId: target.scope.projectId, actorId: target.actorId });
  }
  compare((await service.getBranch(intent.snapshot.scope)).revision, intent.previousRevision);
  if (intent.projectVersion !== undefined) {
    compare((await service.getProject(intent.snapshot.scope.projectId)).version, intent.projectVersion);
  }
  const previous = new Map((await service.listFiles(intent.snapshot.scope)).map(file => [file.id, file]));
  for (const file of intent.files) {
    const old = previous.get(file.id);
    if (file.link?.kind !== "project" || (old?.blob === file.blob && JSON.stringify(old.link) === JSON.stringify(file.link))) continue;
    const [projectId, fileId] = z.tuple([IdSchema, IdSchema]).parse(file.link.sourceId.split(":"));
    const source = await service.getProject(projectId);
    const scope = { projectId, branch: source.defaultBranch };
    await service.authorize(intent.snapshot.authorId, scope, "read");
    if ((await service.getFile(scope, fileId)).blob !== file.blob) fail("LINK_CONFLICT", 409, "Linked source changed during preparation");
  }
}

export async function finalizeSource(context: TransactionContext, intent: SourceIntent, lease: BranchLease): Promise<void> {
  const { snapshot } = intent;
  const tx = context.db;
  await validateSource(context, intent, lease);
  const pending = await tx.get<{ owner: string; fence: number }>(
    "SELECT owner,fence FROM base_source_intents WHERE id=?", [snapshot.id]);
  if (!pending || pending.owner !== lease.owner || pending.fence !== lease.fence) {
    fail("STALE_SOURCE_FENCE", 409, "Source intent belongs to another writer");
  }
  await context.repositories.finalize(tx, snapshot.id, lease);
  const events = await applySourceRecords(context, intent);
  for (const event of events) await context.events.record(tx, event);
}
/** Internal DML; callers must validate every source and its publication first. */
export async function applySourceRecords(context: TransactionContext, intent: SourceIntent): Promise<readonly PendingEvent[]> {
  const { snapshot, branchId } = intent;
  const tx = context.db;
  const now = context.clock.now();
  (await tx.run("UPDATE files SET deleted_at=?,updated_at=? WHERE branch_id=? AND deleted_at IS NULL", [now, now, branchId]));
  for (const file of intent.files) {
    if (file.blob) (await referenceBlob(tx, { digest: file.blob, bytes: file.bytes }, context.clock));
    (await tx.run(`INSERT INTO files(id,branch_id,path,kind,mime,blob,bytes,editable,revision,epoch,link_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id,branch_id) DO UPDATE SET
      path=excluded.path,kind=excluded.kind,mime=excluded.mime,blob=excluded.blob,bytes=excluded.bytes,
      editable=excluded.editable,revision=excluded.revision,epoch=excluded.epoch,link_json=excluded.link_json,
      deleted_at=NULL,updated_at=excluded.updated_at`, [file.id, branchId, file.path, file.kind, file.mime, file.blob, file.bytes, Number(file.editable), file.version.revision, file.version.epoch, file.link ? JSON.stringify(file.link) : null, now, now]));
    if (file.link?.kind === "project") {
      const [projectId, fileId] = z.tuple([IdSchema, IdSchema]).parse(file.link.sourceId.split(":"));
      const existing = (await tx.get<{ id: string }>("SELECT id FROM linked_files WHERE file_id=? AND branch_id=?", [file.id, branchId]));
      if (existing) {
        (await tx.run(`UPDATE linked_files SET expected_digest=?,source_digest=?,last_refreshed_at=?,version=version+1 WHERE id=?`, [file.blob, file.blob, file.link.lastRefreshedAt, existing.id]));
      } else {
        (await tx.run(`INSERT INTO linked_files(id,file_id,branch_id,kind,source_project_id,source_file_id,
          expected_digest,source_digest,last_refreshed_at) VALUES(?,?,?,'project',?,?,?,?,?)`, [newId(), file.id, branchId, projectId, fileId, file.blob, file.blob, file.link.lastRefreshedAt]));
      }
    }
  }
  for (const doc of intent.documents) {
    (await tx.run(`INSERT INTO document_states(doc_id,file_id,branch_id,epoch,revision,text,state,state_vector,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(file_id,branch_id) DO UPDATE SET epoch=excluded.epoch,
      revision=excluded.revision,text=excluded.text,state=excluded.state,state_vector=excluded.state_vector,updated_at=excluded.updated_at`, [doc.docId, doc.fileId, branchId, doc.epoch, doc.revision, doc.text, Buffer.from(doc.state, "base64"), Buffer.from(doc.vector, "base64"), now]));
    (await tx.run(`INSERT INTO document_updates(id,doc_id,client_id,client_seq,epoch,revision,update_bytes,author_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, [newId(), doc.docId, `checkpoint:${snapshot.id}`, 0, doc.epoch, doc.revision, Buffer.from(doc.state, "base64"), snapshot.authorId, now]));
  }
  (await tx.run("UPDATE branch_workspaces SET revision=?,updated_at=? WHERE id=?", [snapshot.revision, now, branchId]));
  (await tx.run("UPDATE projects SET version=version+1,updated_at=? WHERE id=?", [now, snapshot.scope.projectId]));
  (await tx.run(`INSERT INTO snapshots(id,project_id,branch,revision,tree,author_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?)`, [snapshot.id, snapshot.scope.projectId, snapshot.scope.branch, snapshot.revision, snapshot.tree, snapshot.authorId, snapshot.reason, snapshot.createdAt]));
  for (const file of intent.files) {
    (await tx.run(`INSERT INTO snapshot_files(snapshot_id,file_id,path,kind,mime,blob,bytes,editable,revision,epoch,link_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [snapshot.id, file.id, file.path, file.kind, file.mime, file.blob, file.bytes, Number(file.editable), file.version.revision, file.version.epoch, file.link ? JSON.stringify(file.link) : null]));
  }
  (await tx.run("UPDATE git_intents SET state='finalized',snapshot_id=?,finalized_at=? WHERE id=?", [snapshot.id, now, snapshot.id]));
  (await tx.run("DELETE FROM base_source_intents WHERE id=?", [snapshot.id]));
  if (intent.finalization) await applyFinalization(context, intent.finalization);
  if (intent.receipt) await saveReceipt(context, intent.receipt);
  if (intent.http) await saveSourceHttpReceipt(context, { receipt: intent.http, snapshot, files: intent.files });
  const events: PendingEvent[] = [...intent.finalization?.events ?? []];
  for (const doc of intent.documents) {
    events.push({
      topic: "document.saved", aggregateId: snapshot.scope.projectId,
      payload: { resourceId: IdSchema.parse(doc.fileId), revision: doc.revision, epoch: doc.epoch }
    });
  }
  events.push({
    topic: "tree.changed", aggregateId: snapshot.scope.projectId,
    payload: { resourceId: snapshot.scope.projectId, version: snapshot.revision }
  });
  return events;
}
