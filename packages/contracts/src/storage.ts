import type { z } from "zod";
import type { Id, Scope, GitOid, Instant } from "./primitives";

export type SqlDialect = "sqlite" | "postgres";
export type SqlValue = string | number | bigint | boolean | Uint8Array | null;
export type SqlResult = { readonly changes: number };
export interface SqlExecutor {
  readonly dialect: SqlDialect;
  get<T = Record<string, unknown>>(sql: string, parameters?: readonly SqlValue[]): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, parameters?: readonly SqlValue[]): Promise<readonly T[]>;
  run(sql: string, parameters?: readonly SqlValue[]): Promise<SqlResult>;
  exec(sql: string): Promise<void>;
  execute(sql: string, parameters?: readonly SqlValue[]): Promise<number>;
  query<T extends z.ZodType>(sql: string, parameters: readonly SqlValue[], row: T): Promise<readonly z.output<T>[]>;
}
export interface Transaction extends SqlExecutor {
  readonly transaction: true;
  /** Acquire aggregate locks in stable sorted order, before recording events. */
  lock(key: string): Promise<void>;
}
export interface UnitOfWork {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
export type Migration = {
  readonly id: string;
  /** Immutable original SQLite SQL, including whitespace. */
  readonly sql: string;
  /** Explicit PostgreSQL variant; absence is an error on PostgreSQL. */
  readonly postgres?: string;
};
export type BranchLease = {
  readonly scope: Scope; readonly owner: string; readonly fence: number; readonly expiresAt: Instant;
};
export interface BranchCoordinator {
  acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null>;
  renew(lease: BranchLease, ttlMs: number): Promise<BranchLease>;
  release(lease: BranchLease): Promise<void>;
  assert(tx: Transaction, lease: BranchLease): Promise<void>;
  /** Local/remote wake-up is advisory; assert remains authoritative. */
  subscribe(listener: (scope: Scope) => void): () => void;
  close(): Promise<void>;
}
export type RepositoryRefUpdate = {
  readonly ref: string; readonly expected: GitOid | null; readonly next: GitOid | null;
};
export type RepositoryIntent = {
  readonly id: Id; readonly lease: BranchLease; readonly updates: readonly RepositoryRefUpdate[];
};
export type RepositoryIntentState = "prepared" | "published" | "finalized" | "conflicted";
export interface RepositoryService {
  initialize(projectId: Id): Promise<void>;
  /** Trusted internal object commands only; never ref mutation or public transport. */
  objects(projectId: Id, args: readonly string[], input?: Uint8Array): Promise<Uint8Array>;
  /** Finalized visibility check and read command hold one repository admission gate. */
  read(projectId: Id, args: readonly string[]): Promise<Uint8Array>;
  /** Journal, fence admission and atomic Git CAS share the repository execution queue. */
  publish(intent: RepositoryIntent): Promise<void>;
  /** A current owner adopts an unfinished intent before reconciling Git. */
  recover(id: Id, lease: BranchLease): Promise<void>;
  /** Called inside the source finalization transaction, after authorization/revision checks. */
  finalize(tx: Transaction, id: Id, lease: BranchLease): Promise<void>;
  /** Public callers must authorize; no unfinished project intent may be visible. */
  assertReadable(projectId: Id): Promise<void>;
  exportNamed(projectId: Id): Promise<Uint8Array>;
  importPack(projectId: Id, pack: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
