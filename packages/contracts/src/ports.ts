import type { Id, Instant, Digest, Scope, GitOid, Capability } from "./primitives";
import type { Snapshot, FileEntry, ProposedEdit } from "./projects";
import type { CompileRequest, CompileJob, Publication, Operation } from "./work";

export interface ProjectPort {
  authorize(actorId: Id, scope: Scope, action: string): Promise<void>;
  authorizeRequest(request: Request, scope: Scope, action: string): Promise<Id | null>;
  snapshot(actorId: Id, scope: Scope, expectedRevision: number): Promise<Snapshot>;
  readSnapshot(snapshotId: Id): Promise<{ readonly files: readonly FileEntry[]; readonly tree: GitOid }>;
  applyEdits(actorId: Id, scope: Scope, edits: readonly ProposedEdit[],
    key: string): Promise<{ readonly revision: number; readonly conflicts: readonly Id[] }>;
}
export interface CompilePort {
  enqueue(actorId: Id, request: CompileRequest, key: string): Promise<CompileJob>;
  get(actorId: Id, id: Id): Promise<CompileJob>;
  cancel(actorId: Id, id: Id): Promise<void>;
}
export interface AiProvider {
  invoke(input: {
    readonly mode: "ask" | "agent"; readonly prompt: string;
    readonly files: readonly { readonly id: Id; readonly path: string; readonly text: string }[];
    readonly images: readonly { readonly mime: "image/png" | "image/jpeg"; readonly bytes: Uint8Array }[];
    readonly signal: AbortSignal;
  }): Promise<{
    readonly text: string; readonly edits: readonly ProposedEdit[];
    readonly sources: readonly Publication[]; readonly providerRequestId: string;
  }>;
}
export interface ExternalAdapter {
  availability(): Promise<Capability>;
  capabilities(): Readonly<Record<string, Capability>>;
  test(grantId: Id, actorId: Id): Promise<{ readonly ok: boolean; readonly reason?: string }>;
  execute(input: {
    readonly actorId: Id; readonly parameters: Readonly<Record<string, unknown>>;
    readonly expectedVersion: number;
    readonly action: string; readonly grantId: Id; readonly projectId?: Id;
    readonly expectedCursor: string | null; readonly key: string;
  }): Promise<Operation>;
}
export interface Clock { now(): Instant; }
export interface BlobStore {
  put(bytes: Uint8Array): Promise<Digest>;
  get(hash: Digest): Promise<Uint8Array>;
}
