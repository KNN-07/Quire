import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { IdSchema, assertNever } from "@quire/contracts";
import type { RealtimeClientMessage, RealtimeServerMessage, TextDocument } from "@quire/contracts";
import type { DocumentSnapshot, EditorDocument, EditorWorkspace, PersistenceStatus, SourceEdit } from "../shared";
import { readOnlyReason } from "../shared";
import { decode, encode } from "./codec";
import { offlineWindowMs } from "./config";

export class TransportError extends Error {
  readonly name = "TransportError";
  constructor(readonly code: string, message: string) { super(message); }
}
type Update = Extract<RealtimeClientMessage, { readonly type: "update" }>;
const remote = Symbol("remote");
/** Mutable owner of one file/branch document and its durable acknowledgement queue. */
export class PersistentDocument implements EditorDocument {
  private readonly offlineWindow = offlineWindowMs();
  readonly ydoc = new Y.Doc();
  readonly source = this.ydoc.getText("source");
  readonly awareness = new Awareness(this.ydoc);
  readonly scope;
  readonly file;
  private workspace;
  private readonly clientId = IdSchema.parse(crypto.randomUUID());
  private sequence = 0;
  private readonly pending: Update[] = [];
  private readonly listeners = new Set<() => void>();
  private snapshot: DocumentSnapshot;
  private send: ((message: RealtimeClientMessage) => void) | null = null;
  private synced = false;
  private inFlight: number | null = null;
  private acknowledgedRevision: number;
  private offlineTimer: ReturnType<typeof setTimeout> | undefined;
  private offlineSince: number | null = null;
  constructor(workspace: EditorWorkspace, initial: TextDocument) {
    this.workspace = workspace;
    this.scope = workspace.scope;
    this.file = initial.file;
    this.acknowledgedRevision = initial.file.version.revision;
    this.snapshot = { version: initial.file.version, persistence: { kind: "connecting" },
      readOnly: true, readOnlyReason: "Connecting to the document" };
    Y.applyUpdate(this.ydoc, decode(initial.updateBase64), remote);
    this.ydoc.on("update", this.localUpdate);
  }
  readonly getSnapshot = (): DocumentSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(persistence: PersistenceStatus): void {
    const reason = readOnlyReason(this.workspace.access, this.file, persistence);
    this.snapshot = { version: this.snapshot.version, persistence, readOnly: reason !== null, readOnlyReason: reason };
    for (const listener of this.listeners) listener();
  }
  readonly replace = (edits: readonly SourceEdit[]): void => {
    if (this.snapshot.readOnly) throw new TransportError("READ_ONLY", this.snapshot.readOnlyReason ?? "Read only");
    const sorted = [...edits].sort((left, right) => left.from - right.from);
    let end = 0;
    for (const edit of sorted) {
      if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < end
        || edit.from < 0 || edit.to < edit.from || edit.to > this.source.length) {
        throw new TransportError("INVALID_EDIT", "Edits must be valid non-overlapping UTF-16 ranges");
      }
      end = edit.to;
    }
    this.ydoc.transact(() => {
      for (const edit of sorted.reverse()) {
        this.source.delete(edit.from, edit.to - edit.from);
        this.source.insert(edit.from, edit.insert);
      }
    });
  };
  private readonly localUpdate = (bytes: Uint8Array, origin: unknown): void => {
    if (origin === remote) return;
    this.pending.push({ type: "update", fileId: this.file.id, epoch: this.snapshot.version.epoch,
      clientId: this.clientId, clientSeq: ++this.sequence, updateBase64: encode(bytes) });
    if (this.snapshot.readOnly) {
      this.recover("READ_ONLY_EDIT", "Local changes retained; editing is not authorized", null);
      return;
    }
    this.progress();
    this.pump();
  };
  private progress(): void {
    switch (this.snapshot.persistence.kind) {
      case "recovery": case "closed": return;
      case "offline":
        this.publish({ ...this.snapshot.persistence, pendingUpdates: this.pending.length });
        return;
      case "connecting": if (!this.synced) return; break;
      case "saving": case "saved": break;
      default: return assertNever(this.snapshot.persistence);
    }
    this.publish(this.pending.length ? { kind: "saving", pendingUpdates: this.pending.length,
      acknowledgedRevision: this.acknowledgedRevision } : { kind: "saved", revision: this.acknowledgedRevision });
  }
  connect(send: (message: RealtimeClientMessage) => void): void {
    if (this.terminal()) return;
    clearTimeout(this.offlineTimer);
    this.send = send;
    this.synced = false;
    this.inFlight = null;
    this.publish({ kind: "connecting" });
    send({ type: "sync", fileId: this.file.id, epoch: this.snapshot.version.epoch,
      stateVectorBase64: encode(Y.encodeStateVector(this.ydoc)) });
  }
  disconnect(): void {
    this.send = null;
    this.synced = false;
    this.inFlight = null;
    if (this.terminal()) return;
    const since = this.offlineSince ?? Date.now();
    this.offlineSince = since;
    this.publish({ kind: "offline", pendingUpdates: this.pending.length, editable: Date.now() - since < this.offlineWindow, since });
    clearTimeout(this.offlineTimer);
    this.offlineTimer = setTimeout(() => {
      if (this.snapshot.persistence.kind === "offline") this.publish({ ...this.snapshot.persistence, editable: false });
    }, Math.max(0, this.offlineWindow - (Date.now() - since)));
  }
  private terminal(): boolean {
    return this.snapshot.persistence.kind === "recovery" || this.snapshot.persistence.kind === "closed";
  }
  private pump(): void {
    const next = this.pending[0];
    if (this.send && this.synced && !this.inFlight && next && !this.terminal()) {
      this.inFlight = next.clientSeq;
      this.send(next);
    }
  }
  receive(message: RealtimeServerMessage): void {
    if (this.terminal()) return;
    switch (message.type) {
      case "ack": {
        const first = this.pending[0];
        if (!first || message.clientId !== this.clientId || message.clientSeq !== first.clientSeq
          || message.clientSeq !== this.inFlight) return;
        this.pending.shift();
        this.inFlight = null;
        this.acknowledgedRevision = Math.max(this.acknowledgedRevision, message.revision);
        this.snapshot = { ...this.snapshot, version: { ...this.snapshot.version,
          revision: Math.max(this.snapshot.version.revision, message.revision) } };
        this.progress(); this.pump();
        return;
      }
      case "update":
        if (message.fileId !== this.file.id) return;
        if (message.epoch !== this.snapshot.version.epoch) {
          this.recover("EPOCH_CHANGED", "Recover local edits before opening the new document epoch", null); return;
        }
        Y.applyUpdate(this.ydoc, decode(message.updateBase64), remote);
        this.snapshot = { ...this.snapshot, version: { epoch: message.epoch,
          revision: Math.max(this.snapshot.version.revision, message.revision) } };
        this.acknowledgedRevision = Math.max(this.acknowledgedRevision, message.revision);
        this.offlineSince = null;
        clearTimeout(this.offlineTimer);
        this.synced = true;
        this.progress(); this.pump();
        return;
      case "error": this.recover(message.code, message.message, message.recoveryText); return;
      case "presence": return;
      default: return assertNever(message);
    }
  }
  updateWorkspace(workspace: EditorWorkspace): void {
    this.workspace = workspace;
    if (!workspace.access.capabilities.edit && this.pending.length) {
      this.recover("ACCESS_CHANGED", "Editing access changed; local edits retained", null);
    } else this.publish(this.snapshot.persistence);
  }
  recover(code: string, message: string, serverText: string | null): void {
    this.publish({ kind: "recovery", code, message, localText: this.source.toJSON(), serverText });
  }
  readonly flush = (signal?: AbortSignal): Promise<void> => {
    const target = this.sequence;
    return new Promise<void>((resolve, reject) => {
      const abort = () => { unsubscribe(); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
      const check = () => {
        if (this.terminal()) {
          unsubscribe(); signal?.removeEventListener("abort", abort);
          reject(new TransportError("RECOVERY_REQUIRED", "Document closed or requires recovery")); return;
        }
        if (this.synced && !this.pending.some(update => update.clientSeq <= target)) {
          unsubscribe(); signal?.removeEventListener("abort", abort); resolve();
        }
      };
      const unsubscribe = this.subscribe(check);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort(); else check();
    });
  };
  close(): void {
    this.send = null;
    clearTimeout(this.offlineTimer);
    this.publish({ kind: "closed", reason: "Document disposed" });
    this.ydoc.off("update", this.localUpdate);
    this.awareness.destroy();
    this.ydoc.destroy();
    this.listeners.clear();
  }
}
