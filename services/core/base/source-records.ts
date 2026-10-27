import { z } from "zod";
import * as Y from "yjs";
import { FileEntrySchema, SnapshotSchema, IdSchema } from "@quire/contracts";
import type { FileEntry } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { referenceBlob } from "@quire/runtime";
import { newId } from "./store";

export const documentRecord = z.object({
  fileId: z.string(), docId: z.string(), text: z.string(), state: z.string(), vector: z.string(),
  revision: z.number(), epoch: z.number(),
});
export const sourceIntent = z.object({
  snapshot: SnapshotSchema, branchId: z.string(), previousRevision: z.number(),
  files: z.array(FileEntrySchema), documents: z.array(documentRecord), commit: z.string(),
  receipt: z.object({ actorId: IdSchema, key: z.string(), route: z.string(),
    digest: z.string(), response: z.string() }).optional(),
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
export function finalizeSource(context: ModuleContext, intent: SourceIntent): void {
  const { snapshot, branchId } = intent;
  const tx = context.db;
  const now = context.clock.now();
  tx.query("UPDATE files SET deleted_at=?,updated_at=? WHERE branch_id=? AND deleted_at IS NULL")
    .run(now, now, branchId);
  for (const file of intent.files) {
    if (file.blob) referenceBlob(tx, { digest: file.blob, bytes: file.bytes }, context.clock);
    tx.query(`INSERT INTO files(id,branch_id,path,kind,mime,blob,bytes,editable,revision,epoch,link_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id,branch_id) DO UPDATE SET
      path=excluded.path,kind=excluded.kind,mime=excluded.mime,blob=excluded.blob,bytes=excluded.bytes,
      editable=excluded.editable,revision=excluded.revision,epoch=excluded.epoch,link_json=excluded.link_json,
      deleted_at=NULL,updated_at=excluded.updated_at`).run(
      file.id, branchId, file.path, file.kind, file.mime, file.blob, file.bytes, Number(file.editable),
      file.version.revision, file.version.epoch, file.link ? JSON.stringify(file.link) : null, now, now);
    if (file.link?.kind === "project") {
      const [projectId, fileId] = z.tuple([IdSchema, IdSchema]).parse(file.link.sourceId.split(":"));
      const existing = tx.query<{ id: string }, [string, string]>(
        "SELECT id FROM linked_files WHERE file_id=? AND branch_id=?").get(file.id, branchId);
      if (existing) {
        tx.query(`UPDATE linked_files SET expected_digest=?,source_digest=?,last_refreshed_at=?,version=version+1 WHERE id=?`)
          .run(file.blob, file.blob, file.link.lastRefreshedAt, existing.id);
      } else {
        tx.query(`INSERT INTO linked_files(id,file_id,branch_id,kind,source_project_id,source_file_id,
          expected_digest,source_digest,last_refreshed_at) VALUES(?,?,?,'project',?,?,?,?,?)`)
          .run(newId(), file.id, branchId, projectId, fileId, file.blob, file.blob, file.link.lastRefreshedAt);
      }
    }
  }
  for (const doc of intent.documents) {
    tx.query(`INSERT INTO document_states(doc_id,file_id,branch_id,epoch,revision,text,state,state_vector,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(file_id,branch_id) DO UPDATE SET epoch=excluded.epoch,
      revision=excluded.revision,text=excluded.text,state=excluded.state,state_vector=excluded.state_vector,updated_at=excluded.updated_at`)
      .run(doc.docId, doc.fileId, branchId, doc.epoch, doc.revision, doc.text,
        Buffer.from(doc.state, "base64"), Buffer.from(doc.vector, "base64"), now);
    tx.query(`INSERT INTO document_updates(id,doc_id,client_id,client_seq,epoch,revision,update_bytes,author_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(newId(), doc.docId, `checkpoint:${snapshot.id}`, 0, doc.epoch,
      doc.revision, Buffer.from(doc.state, "base64"), snapshot.authorId, now);
    context.events.append(tx, { topic: "document.saved", aggregateId: snapshot.scope.projectId,
      payload: { resourceId: IdSchema.parse(doc.fileId), revision: doc.revision, epoch: doc.epoch } });
  }
  tx.query("UPDATE branch_workspaces SET revision=?,updated_at=? WHERE id=?")
    .run(snapshot.revision, now, branchId);
  tx.query("UPDATE projects SET version=version+1,updated_at=? WHERE id=?").run(now, snapshot.scope.projectId);
  tx.query(`INSERT INTO snapshots(id,project_id,branch,revision,tree,author_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(snapshot.id, snapshot.scope.projectId, snapshot.scope.branch, snapshot.revision, snapshot.tree,
      snapshot.authorId, snapshot.reason, snapshot.createdAt);
  for (const file of intent.files) {
    tx.query(`INSERT INTO snapshot_files(snapshot_id,file_id,path,kind,mime,blob,bytes,editable,revision,epoch,link_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(snapshot.id, file.id, file.path, file.kind, file.mime, file.blob,
      file.bytes, Number(file.editable), file.version.revision, file.version.epoch, file.link ? JSON.stringify(file.link) : null);
  }
  tx.query("UPDATE git_intents SET state='finalized',snapshot_id=?,finalized_at=? WHERE id=?")
    .run(snapshot.id, now, snapshot.id);
  tx.query("DELETE FROM base_source_intents WHERE id=?").run(snapshot.id);
  if (intent.receipt) {
    tx.query(`INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at)
      VALUES(?,?,?,?,200,?,?)`).run(intent.receipt.actorId, intent.receipt.key, intent.receipt.route,
      intent.receipt.digest, intent.receipt.response, now);
  }
  context.events.append(tx, { topic: "tree.changed", aggregateId: snapshot.scope.projectId,
    payload: { resourceId: snapshot.scope.projectId, version: snapshot.revision } });
}
