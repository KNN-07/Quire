import { z } from "zod";
import * as Y from "yjs";
import { FileEntrySchema, SnapshotSchema, TextDocumentSchema, IdSchema } from "@quire/contracts";
import type { Id, Scope, FileEntry, ProjectPort, ProposedEdit, Snapshot } from "@quire/contracts";
import { AccessStore } from "./access";
import { compare, fail, newId, fileFromRow } from "./store";
import { git, repositoryPath, writeCheckpoint } from "./git-checkpoint";
import { finalizeSource, sourceIntent, materializeDocument } from "./source-records";
import type { SourceInput, SourceDocument, SourceIntent } from "./source-records";
import { checkFiles, decodeText } from "./limits";
import { isCodePointBoundary } from "./unicode";

const queues = new WeakMap<object, Map<string, Promise<unknown>>>();
export class SourceService extends AccessStore implements ProjectPort {
  async serialized<T>(scope: Scope, work: () => Promise<T>): Promise<T> {
    let queue = queues.get(this.context.db);
    if (!queue) { queue = new Map(); queues.set(this.context.db, queue); }
    const key = `${scope.projectId}:${scope.branch}`;
    const result = (queue.get(key) ?? Promise.resolve()).then(work);
    const tail = result.then(() => undefined, () => undefined);
    queue.set(key, tail);
    try { return await result; }
    finally { if (queue.get(key) === tail) queue.delete(key); }
  }
  loadDocument(scope: Scope, fileId: Id): SourceDocument {
    const row = this.one("SELECT * FROM document_states WHERE branch_id=? AND file_id=?",
      [this.getBranch(scope).id, fileId], z.object({
        doc_id: z.string(), text: z.string(), state: z.instanceof(Uint8Array),
        state_vector: z.instanceof(Uint8Array), revision: z.number(), epoch: z.number(),
      }));
    return { fileId, docId: row.doc_id, text: row.text, state: Buffer.from(row.state).toString("base64"),
      vector: Buffer.from(row.state_vector).toString("base64"), revision: row.revision, epoch: row.epoch };
  }
  readDocument(scope: Scope, id: Id) {
    const file = this.getFile(scope, id);
    if (!file.editable) fail("NOT_EDITABLE", 422, "File is binary or exceeds editable limit");
    const document = this.loadDocument(scope, id);
    return TextDocumentSchema.parse({ file, text: document.text, stateVectorBase64: document.vector, updateBase64: document.state });
  }
  async readSnapshot(snapshotId: Id) {
    const snapshot = this.getSnapshot(snapshotId);
    const files = this.context.db.query("SELECT file_id AS id,* FROM snapshot_files WHERE snapshot_id=? ORDER BY path")
      .all(snapshotId).map(fileFromRow);
    return { files, tree: snapshot.tree };
  }
  async snapshot(actorId: Id, scope: Scope, expectedRevision: number): Promise<Snapshot> {
    return this.serialized(scope, async () => {
      await this.authorize(actorId, scope, "snapshot");
      return this.commitSource({ actorId, scope, expectedRevision, inputs: this.listFiles(scope).map((file) => ({ file })),
        reason: "checkpoint", advance: false });
    });
  }
  /** Caller must hold serialized(scope). Blobs, Yjs, Git intent and SQL/outbox become one source boundary. */
  async commitSource(input: {
    readonly actorId: Id; readonly scope: Scope; readonly expectedRevision: number;
    readonly inputs: readonly SourceInput[]; readonly reason?: Snapshot["reason"]; readonly advance?: boolean;
    readonly receipt?: SourceIntent["receipt"];
  }): Promise<Snapshot> {
    const branch = this.getBranch(input.scope);
    await this.authorize(input.actorId, input.scope, input.advance === false ? "snapshot" : "write");
    compare(branch.revision, input.expectedRevision);
    const revision = branch.revision + (input.advance === false ? 0 : 1);
    const previousFiles = new Map(this.listFiles(input.scope).map((file) => [file.id, file]));
    const files: FileEntry[] = [];
    const documents: SourceDocument[] = [];
    for (const item of input.inputs) {
      if (item.document && !item.document.getText("source").toJSON().isWellFormed()) {
        fail("INVALID_UNICODE", 422, "Source edit splits a UTF-16 surrogate pair");
      }
      const changed = item.bytes !== undefined || item.document !== undefined;
      const previousFile = previousFiles.get(item.file.id);
      const metadataChanged = !previousFile || previousFile.path !== item.file.path
        || previousFile.blob !== item.file.blob || JSON.stringify(previousFile.link) !== JSON.stringify(item.file.link)
        || previousFile.version.epoch !== item.file.version.epoch;
      const bytes = item.document ? new TextEncoder().encode(item.document.getText("source").toJSON()) : item.bytes;
      const blob = bytes ? await this.context.blobs.put(bytes) : item.file.blob;
      const text = bytes ? decodeText(bytes) : null;
      if (item.document && text === null) fail("FILE_EDIT_LIMIT", 413, "Edited source exceeds the text editing limit");
      const file = FileEntrySchema.parse({ ...item.file, blob, bytes: bytes?.length ?? item.file.bytes,
        editable: bytes ? text !== null && item.file.link === null : item.file.editable,
        version: changed || metadataChanged ? { revision, epoch: item.file.version.epoch } : item.file.version });
      files.push(file);
      if (file.editable) {
        if (changed) {
          const previous = this.context.db.query("SELECT 1 FROM document_states WHERE file_id=? AND branch_id=?")
            .get(file.id, branch.id) ? this.loadDocument(input.scope, file.id) : undefined;
          documents.push(materializeDocument({ file, text: text ?? "", ...(previous ? { previous } : {}),
            ...(item.document ? { document: item.document } : {}) }));
        } else if (metadataChanged) {
          const previous = this.loadDocument(input.scope, file.id);
          documents.push({ ...previous, revision: file.version.revision, epoch: file.version.epoch });
        }
      }
    }
    checkFiles(files);
    const project = this.getProject(input.scope.projectId);
    const main = files.find((file) => file.id === project.settings.mainFileId);
    if (!main || !main.editable || main.link || !main.path.endsWith(".tex")) fail("INVALID_MAIN", 422, "Main must be an editable unlinked TeX file");
    const mainInput = input.inputs.find((item) => item.file.id === main.id);
    const mainText = mainInput?.document?.getText("source").toJSON()
      ?? (mainInput?.bytes ? decodeText(mainInput.bytes) : this.context.db.query<{ text: string }, [string, string]>(
        "SELECT text FROM document_states WHERE file_id=? AND branch_id=?").get(main.id, branch.id)?.text);
    if (project.settings.engine !== "plain" && !mainText?.includes("\\documentclass")) fail("INVALID_MAIN", 422, "Main requires a documentclass");
    const checkpoint = await writeCheckpoint(this.context, input.scope.projectId, files);
    const snapshot = SnapshotSchema.parse({ id: newId(), scope: input.scope, revision, tree: checkpoint.tree,
      authorId: input.actorId, createdAt: this.context.clock.now(), reason: input.reason ?? "checkpoint" });
    const intent = { snapshot, branchId: branch.id, previousRevision: branch.revision,
      files, documents, commit: checkpoint.commit, ...(input.receipt ? { receipt: input.receipt } : {}) };
    this.context.uow.local((tx) => {
      compare(this.getBranch(input.scope).revision, branch.revision);
      const role = this.role(input.actorId, input.scope.projectId);
      if (input.advance !== false && role !== "owner" && role !== "editor") fail("FORBIDDEN", 403, "Source permission was revoked");
      tx.query(`INSERT INTO git_intents(id,project_id,branch,new_ref,tree,state,idempotency_key,created_at)
        VALUES(?,?,?,?,?,'prepared',?,?)`).run(snapshot.id, input.scope.projectId, input.scope.branch,
        checkpoint.commit, snapshot.tree, `base:${snapshot.id}`, snapshot.createdAt);
      tx.query("INSERT INTO base_source_intents(id,payload_json) VALUES(?,?)").run(snapshot.id, JSON.stringify(intent));
    });
    await git(repositoryPath(this.context, input.scope.projectId),
      ["update-ref", `refs/quire/history/${snapshot.id}`, checkpoint.commit]);
    this.context.uow.local(() => finalizeSource(this.context, intent));
    this.context.events.dispatch();
    return snapshot;
  }
  async recover(): Promise<void> {
    const intents = this.rows("SELECT payload_json FROM base_source_intents", [], z.object({ payload_json: z.string() }));
    for (const row of intents) {
      const intent = sourceIntent.parse(JSON.parse(row.payload_json));
      await git(repositoryPath(this.context, intent.snapshot.scope.projectId),
        ["update-ref", `refs/quire/history/${intent.snapshot.id}`, intent.commit]);
      this.context.uow.local(() => {
        compare(this.getBranch(intent.snapshot.scope).revision, intent.previousRevision);
        finalizeSource(this.context, intent);
      });
    }
  }
  async applyEdits(actorId: Id, scope: Scope, edits: readonly ProposedEdit[], key: string) {
    return this.serialized(scope, async () => {
      await this.authorize(actorId, scope, "write");
      const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(edits)).digest("hex");
      const cached = this.context.db.query<{ response_json: string; request_digest: string }, [string, string, string]>(
        "SELECT response_json,request_digest FROM idempotency_results WHERE actor_id=? AND key=? AND route=?")
        .get(actorId, key, `applyEdits:${scope.projectId}:${scope.branch}`);
      const schema = z.object({ revision: z.number(), conflicts: z.array(IdSchema) });
      if (cached) {
        if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key reused with different edits");
        return schema.parse(JSON.parse(cached.response_json));
      }
      const docs = new Map<Id, Y.Doc>();
      const conflicts: Id[] = [];
      try {
        for (const edit of edits) {
          const file = this.getFile(scope, edit.fileId);
          if (!file.editable || file.link || file.version.epoch !== edit.anchor.epoch || edit.anchor.fileId !== file.id
            || edit.baseRevision > this.getBranch(scope).revision) {
            conflicts.push(edit.id); continue;
          }
          let doc = docs.get(file.id);
          if (!doc) { doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(this.loadDocument(scope, file.id).state, "base64")); docs.set(file.id, doc); }
          const text = doc.getText("source");
          const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(edit.anchor.startRelative, "base64")), doc);
          const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(edit.anchor.endRelative, "base64")), doc);
          if (!start || !end || start.type !== text || end.type !== text || start.index > end.index
            || !isCodePointBoundary(text.toJSON(), start.index) || !isCodePointBoundary(text.toJSON(), end.index)
            || !edit.after.isWellFormed()
            || text.toJSON().slice(start.index, end.index) !== edit.before) { conflicts.push(edit.id); continue; }
          doc.transact(() => { text.delete(start.index, end.index - start.index); text.insert(start.index, edit.after); });
        }
        if (conflicts.length) return { revision: this.getBranch(scope).revision, conflicts };
        const result = { revision: this.getBranch(scope).revision + 1, conflicts };
        await this.commitSource({ actorId, scope, expectedRevision: this.getBranch(scope).revision,
          receipt: { actorId, key, route: `applyEdits:${scope.projectId}:${scope.branch}`, digest, response: JSON.stringify(result) },
          inputs: this.listFiles(scope).map((file) => {
            const document = docs.get(file.id);
            return { file, ...(document ? { document } : {}) };
          }) });
        return result;
      } finally { for (const doc of docs.values()) doc.destroy(); }
    });
  }
}
