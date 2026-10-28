import { z } from "zod";
import * as Y from "yjs";
import { FileEntrySchema, SnapshotSchema, TextDocumentSchema, IdSchema } from "@quire/contracts";
import type { Id, Scope, FileEntry, ProjectPort, ProposedEdit, Snapshot, BranchLease, Transaction } from "@quire/contracts";
import { AccessStore } from "./access";
import { compare, fail, newId, fileFromRow } from "./store";
import { writeCheckpoint } from "./git-checkpoint";
import { materializeDocument, validateSource } from "./source-records";
import type { SourceDocument, SourceIntent } from "./source-records";
import type { HttpReceipt } from "./receipts";
import { publishSource, recoverBranch } from "./source-recovery";
import { sourceFinalization } from "./source-finalization";
import type { SourceFinalization } from "./source-finalization";
import { finalizePreparedSources as finalizePreparedBatch } from "./source-composition";
import type { PreparedSources, SourceCommitInput, SourcePreparation } from "./source-composition";
import { checkFiles, decodeText } from "./limits";
import { isCodePointBoundary } from "./unicode";
import { mainPathAllowed } from "./main-file";

const queues = new WeakMap<object, Map<string, Promise<unknown>>>();
export class SourceService extends AccessStore implements ProjectPort {
  withTransaction(tx: Transaction): SourceService {
    return new SourceService({ ...this.context, db: tx });
  }
  async serialized<T>(scope: Scope, work: (lease: BranchLease) => Promise<T>): Promise<T> {
    let queue = queues.get(this.context.db);
    if (!queue) { queue = new Map(); queues.set(this.context.db, queue); }
    const key = `${scope.projectId}:${scope.branch}`;
    const result = (queue.get(key) ?? Promise.resolve()).then(async () => {
      const lease = await this.context.branches.acquire(scope, crypto.randomUUID(), 60_000);
      if (!lease) fail("BRANCH_BUSY", 409, "Another writer owns this branch");
      try {
        await recoverBranch(this.context, lease);
        return await work(lease);
      } finally { await this.context.branches.release(lease); }
    });
    const tail = result.then(() => undefined, () => undefined);
    queue.set(key, tail);
    try { return await result; }
    finally { if (queue.get(key) === tail) queue.delete(key); }
  }
  async loadDocument(scope: Scope, fileId: Id): Promise<SourceDocument> {
    const row = (await this.one("SELECT * FROM document_states WHERE branch_id=? AND file_id=?",
      [(await this.getBranch(scope)).id, fileId], z.object({
        doc_id: z.string(), text: z.string(), state: z.instanceof(Uint8Array),
        state_vector: z.instanceof(Uint8Array), revision: z.number(), epoch: z.number(),
      })));
    return {
      fileId, docId: row.doc_id, text: row.text, state: Buffer.from(row.state).toString("base64"),
      vector: Buffer.from(row.state_vector).toString("base64"), revision: row.revision, epoch: row.epoch
    };
  }
  async readDocument(scope: Scope, id: Id) {
    const file = (await this.getFile(scope, id));
    if (!file.editable) fail("NOT_EDITABLE", 422, "File is binary or exceeds editable limit");
    const document = (await this.loadDocument(scope, id));
    return TextDocumentSchema.parse({ file, text: document.text, stateVectorBase64: document.vector, updateBase64: document.state });
  }
  async readSnapshot(snapshotId: Id) {
    const snapshot = (await this.getSnapshot(snapshotId));
    const files = (await this.context.db.all("SELECT file_id AS id,* FROM snapshot_files WHERE snapshot_id=? ORDER BY path", [snapshotId])).map(fileFromRow);
    return { files, tree: snapshot.tree };
  }
  async snapshot(actorId: Id, scope: Scope, expectedRevision: number): Promise<Snapshot> {
    return this.serialized(scope, async (lease) => {
      await this.authorize(actorId, scope, "snapshot");
      return this.commitSource({
        actorId, scope, lease, expectedRevision, inputs: (await this.listFiles(scope)).map((file) => ({ file })),
        reason: "checkpoint", advance: false
      });
    });
  }
  /** Prepare immutable bytes/objects only; the caller owns durable journal admission. */
  async prepareSource(input: SourcePreparation): Promise<SourceIntent> {
    if ("transaction" in this.context.db && this.context.db.transaction === true) {
      fail("SOURCE_PREPARE_IN_TRANSACTION", 500, "Prepare source objects outside SQL transactions");
    }
    const project = input.creation?.project ?? await this.getProject(input.scope.projectId);
    const branch = input.creation ? { id: input.creation.branchId, revision: 0 }
      : input.newBranchId ? { id: input.newBranchId, revision: 0 } : await this.getBranch(input.scope);
    if (!input.creation) await this.authorize(input.actorId,
      input.newBranchId ? { ...input.scope, branch: project.defaultBranch } : input.scope,
      input.advance === false ? "snapshot" : "write");
    compare(branch.revision, input.expectedRevision);
    const revision = branch.revision + (input.advance === false ? 0 : 1);
    const previousFiles = new Map((input.creation || input.newBranchId ? [] : await this.listFiles(input.scope)).map((file) => [file.id, file]));
    const files: FileEntry[] = [];
    const documents: SourceDocument[] = [];
    for (const item of input.inputs) {
      if (item.document && !item.document.getText("source").toJSON().isWellFormed()) {
        fail("INVALID_UNICODE", 422, "Source edit splits a UTF-16 surrogate pair");
      }
      const changed = item.bytes !== undefined || item.document !== undefined || input.newBranchId !== undefined;
      const previousFile = previousFiles.get(item.file.id);
      const metadataChanged = !previousFile || previousFile.path !== item.file.path
        || previousFile.blob !== item.file.blob || JSON.stringify(previousFile.link) !== JSON.stringify(item.file.link)
        || previousFile.version.epoch !== item.file.version.epoch;
      const bytes = item.document ? new TextEncoder().encode(item.document.getText("source").toJSON()) : item.bytes
        ?? (input.newBranchId && item.file.kind === "file" && item.file.blob ? await this.context.blobs.get(item.file.blob) : undefined);
      const blob = bytes ? await this.context.blobs.put(bytes) : item.file.blob;
      const text = bytes ? decodeText(bytes) : null;
      if (item.document && text === null) fail("FILE_EDIT_LIMIT", 413, "Edited source exceeds the text editing limit");
      const file = FileEntrySchema.parse({
        ...item.file, blob, bytes: bytes?.length ?? item.file.bytes,
        editable: bytes ? text !== null && item.file.link === null : item.file.editable,
        version: changed || metadataChanged ? { revision, epoch: item.file.version.epoch } : item.file.version
      });
      files.push(file);
      if (file.editable) {
        if (changed) {
          const previous = (await this.context.db.get("SELECT 1 FROM document_states WHERE file_id=? AND branch_id=?", [file.id, branch.id])) ? (await this.loadDocument(input.scope, file.id)) : undefined;
          documents.push(materializeDocument({
            file, text: text ?? "", ...(previous ? { previous } : {}),
            ...(item.document ? { document: item.document } : {})
          }));
        } else if (metadataChanged) {
          const previous = (await this.loadDocument(input.scope, file.id));
          documents.push({ ...previous, revision: file.version.revision, epoch: file.version.epoch });
        }
      }
    }
    checkFiles(files);
    const main = files.find((file) => file.id === project.settings.mainFileId);
    if (!main || !main.editable || main.link || !await mainPathAllowed(this.context, project.settings.environmentId, main.path)) {
      fail("INVALID_MAIN", 422, "Main must be editable unlinked TeX or main.Rnw in a knitr environment");
    }
    if (input.creation && project.settings.engine !== "plain"
      && !documents.find(document => document.fileId === main.id)?.text.includes("\\documentclass")) {
      fail("INVALID_MAIN", 422, "Main requires a documentclass when creating a project");
    }
    const checkpoint = await writeCheckpoint(this.context, input.scope.projectId, files);
    const snapshot = SnapshotSchema.parse({
      id: newId(), scope: input.scope, revision, tree: checkpoint.tree,
      authorId: input.actorId, createdAt: this.context.clock.now(), reason: input.reason ?? "checkpoint"
    });
    const intent: SourceIntent = {
      snapshot, branchId: branch.id, previousRevision: branch.revision,
      projectVersion: project.version, files, documents, commit: checkpoint.commit,
      ...(input.receipt ? { receipt: input.receipt } : {}), ...(input.http ? { http: input.http } : {}),
      ...(input.finalization ? { finalization: sourceFinalization.parse(input.finalization) } : {}),
      ...(input.newBranchId ? { createBranch: true as const } : {}),
    };
    return intent;
  }
  finalizePreparedSources(tx: Transaction, input: PreparedSources) {
    return finalizePreparedBatch(this.context, tx, input);
  }
  /** Caller must hold serialized(scope). Standalone source owns its recovery journal. */
  async commitSource(input: SourceCommitInput): Promise<Snapshot> {
    const intent = await this.prepareSource(input);
    const { snapshot } = intent;
    const project = input.creation?.project ?? await this.getProject(input.scope.projectId);
    const branch = { id: intent.branchId };
    await this.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await this.context.branches.assert(tx, input.lease);
      if (input.http && await tx.get(
        "SELECT 1 FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
        [input.http.actorId, input.http.key, input.http.route])) {
        fail("IDEMPOTENCY_FINALIZED", 409, "Request was finalized by another writer");
      }
      const service = this.withTransaction(tx);
      if (input.creation) {
        await service.readUser(input.actorId);
        if (project.workspaceId && !await tx.get("SELECT 1 FROM members WHERE organization_id=? AND user_id=?",
          [project.workspaceId, input.actorId])) fail("FORBIDDEN", 403, "Workspace membership required");
        await tx.run(`INSERT INTO projects(id,name,owner_id,workspace_id,settings_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)`, [project.id, project.name, project.ownerId, project.workspaceId,
        JSON.stringify(project.settings), project.createdAt, project.updatedAt]);
        await tx.run("INSERT INTO branch_workspaces(id,project_id,branch,created_at,updated_at) VALUES(?,?,?,?,?)",
          [branch.id, project.id, input.scope.branch, project.createdAt, project.updatedAt]);
        await tx.run("INSERT INTO repositories(project_id,relative_path,created_at) VALUES(?,?,?)",
          [project.id, `git/${project.id}.git`, project.createdAt]);
      }
      await validateSource({ ...this.context, db: tx }, intent, input.lease);
      if (await tx.get(`SELECT s.id FROM base_source_intents s JOIN git_intents g ON g.id=s.id
        WHERE g.project_id=?`, [project.id])) fail("SOURCE_RECOVERY_REQUIRED", 409, "An unfinished source intent blocks this project");
      (await tx.run(`INSERT INTO git_intents(id,project_id,branch,new_ref,tree,state,idempotency_key,created_at)
        VALUES(?,?,?,?,?,'prepared',?,?)`, [snapshot.id, input.scope.projectId, input.scope.branch, intent.commit, snapshot.tree, `base:${snapshot.id}`, snapshot.createdAt]));
      await tx.run(`INSERT INTO base_source_intents
        (id,payload_json,owner,fence,receipt_actor_id,receipt_key,receipt_route) VALUES(?,?,?,?,?,?,?)`,
        [snapshot.id, JSON.stringify(intent), input.lease.owner, input.lease.fence,
        input.http?.actorId ?? null, input.http?.key ?? null, input.http?.route ?? null]);
    });
    await publishSource(this.context, intent, input.lease);
    return snapshot;
  }
  async recover(): Promise<void> {
    const scopes = await this.rows(`SELECT DISTINCT g.project_id,g.branch FROM base_source_intents s
      JOIN git_intents g ON g.id=s.id ORDER BY g.project_id,g.branch`, [], z.object({ project_id: IdSchema, branch: z.string() }));
    for (const row of scopes) {
      await this.serialized({ projectId: row.project_id, branch: row.branch }, async () => undefined);
    }
  }
  async recoverReceipt(receipt: HttpReceipt): Promise<void> {
    const pending = await this.context.db.get<{ project_id: Id; branch: string }>(
      `SELECT g.project_id,g.branch FROM base_source_intents s JOIN git_intents g ON g.id=s.id
       WHERE s.receipt_actor_id=? AND s.receipt_key=? AND s.receipt_route=?`,
      [receipt.actorId, receipt.key, receipt.route]);
    if (pending) await this.serialized({ projectId: pending.project_id, branch: pending.branch }, async () => undefined);
  }
  async applyEdits(actorId: Id, scope: Scope, edits: readonly ProposedEdit[], key: string, finalization?: SourceFinalization) {
    return this.serialized(scope, async (lease) => {
      await this.authorize(actorId, scope, "write");
      const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(finalization ? { edits, finalization } : edits)).digest("hex");
      const cached = (await this.context.db.get<{ response_json: string; request_digest: string }>("SELECT response_json,request_digest FROM idempotency_results WHERE actor_id=? AND key=? AND route=?", [actorId, key, `applyEdits:${scope.projectId}:${scope.branch}`]));
      const schema = z.object({ revision: z.number(), conflicts: z.array(IdSchema) });
      if (cached) {
        if (cached.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key reused with different edits");
        return schema.parse(JSON.parse(cached.response_json));
      }
      const docs = new Map<Id, Y.Doc>();
      const conflicts: Id[] = [];
      try {
        for (const edit of edits) {
          const file = (await this.getFile(scope, edit.fileId));
          if (!file.editable || file.link || file.version.epoch !== edit.anchor.epoch || edit.anchor.fileId !== file.id
            || edit.baseRevision > (await this.getBranch(scope)).revision) {
            conflicts.push(edit.id); continue;
          }
          let doc = docs.get(file.id);
          if (!doc) { doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from((await this.loadDocument(scope, file.id)).state, "base64")); docs.set(file.id, doc); }
          const text = doc.getText("source");
          const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(edit.anchor.startRelative, "base64")), doc);
          const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(edit.anchor.endRelative, "base64")), doc);
          if (!start || !end || start.type !== text || end.type !== text || start.index > end.index
            || !isCodePointBoundary(text.toJSON(), start.index) || !isCodePointBoundary(text.toJSON(), end.index)
            || !edit.after.isWellFormed()
            || text.toJSON().slice(start.index, end.index) !== edit.before) { conflicts.push(edit.id); continue; }
          doc.transact(() => { text.delete(start.index, end.index - start.index); text.insert(start.index, edit.after); });
        }
        if (conflicts.length) return { revision: (await this.getBranch(scope)).revision, conflicts };
        const result = { revision: (await this.getBranch(scope)).revision + 1, conflicts };
        await this.commitSource({
          actorId, scope, lease, expectedRevision: (await this.getBranch(scope)).revision,
          ...(finalization ? { finalization } : {}),
          receipt: { actorId, key, route: `applyEdits:${scope.projectId}:${scope.branch}`, digest, response: JSON.stringify(result) },
          inputs: (await this.listFiles(scope)).map((file) => {
            const document = docs.get(file.id);
            return { file, ...(document ? { document } : {}) };
          })
        });
        return result;
      } finally { for (const doc of docs.values()) doc.destroy(); }
    });
  }
}
