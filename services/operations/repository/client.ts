import { z } from "zod";
import type {
  BranchCoordinator, BranchLease, Clock, Id, RepositoryIntent, RepositoryService, Scope, Transaction,
} from "@quire/contracts";
import { StorageError } from "@quire/runtime";
import { assertRepositoryFence, finalizeRepositoryIntent, leaseSchema } from "./journal";
import type { PostgresMutationAdmission } from "../storage/postgres";

export type RepositoryClientOptions = {
  readonly url: string; readonly token: string; readonly clock: Clock;
  readonly admission?: PostgresMutationAdmission;
};
class Connection {
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();
  constructor(private readonly options: RepositoryClientOptions) {
    const url = new URL(options.url);
    if (url.protocol !== "https:" && !(url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
      throw new StorageError("REPOSITORY_TLS_REQUIRED", "Remote repository connections require HTTPS");
    }
  }
  async call<T extends z.ZodType>(method: string, body: unknown, schema: T): Promise<z.output<T>> {
    if (this.closed) throw new StorageError("REPOSITORY_CLOSED", method);
    const invoke = async () => {
      const response = await fetch(new URL(`/v1/${method}`, this.options.url), {
        method: "POST", headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json",
          ...(this.options.admission ? { "x-quire-admission": JSON.stringify(this.options.admission.ticket()) } : {}) },
        body: JSON.stringify(body),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const error = z.object({ error: z.object({ code: z.string() }) }).parse(value);
        throw new StorageError(error.error.code, method);
      }
      return schema.parse(z.object({ result: z.unknown() }).parse(value).result);
    };
    const work = this.options.admission ? this.options.admission.writer(invoke) : invoke();
    this.pending.add(work);
    try { return await work; } finally { this.pending.delete(work); }
  }
  async close(): Promise<void> { this.closed = true; await Promise.allSettled(this.pending); }
}
const nothing = z.null();

export class RemoteRepositoryService implements RepositoryService {
  private readonly connection: Connection;
  constructor(private readonly options: RepositoryClientOptions) { this.connection = new Connection(options); }
  /** Authenticated server-derived identity; the endpoint URL is not volume authority. */
  restoreIdentity() {
    return this.connection.call("restore-identity", {}, z.strictObject({
      host: z.string().min(1), path: z.string().min(1), device: z.string().regex(/^\d+$/),
      inode: z.string().regex(/^\d+$/), empty: z.boolean(),
    }));
  }
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    await this.connection.call("backup-begin", {}, nothing);
    try { return await work(); }
    finally { await this.connection.call("backup-end", {}, nothing); }
  }
  async initialize(projectId: Id): Promise<void> { await this.connection.call("initialize", { projectId }, nothing); }
  async objects(projectId: Id, args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
    return Buffer.from(await this.connection.call("objects",
      { projectId, args, ...(input === undefined ? {} : { input: Buffer.from(input).toString("base64") }) }, z.string()), "base64");
  }
  async read(projectId: Id, args: readonly string[]): Promise<Uint8Array> {
    return Buffer.from(await this.connection.call("read", { projectId, args }, z.string()), "base64");
  }
  async publish(intent: RepositoryIntent): Promise<void> { await this.connection.call("publish", intent, nothing); }
  async recover(id: Id, lease: BranchLease): Promise<void> { await this.connection.call("recover", { id, lease }, nothing); }
  finalize(tx: Transaction, id: Id, lease: BranchLease): Promise<void> {
    return finalizeRepositoryIntent(tx, id, lease, this.options.clock);
  }
  async assertReadable(projectId: Id): Promise<void> { await this.connection.call("readable", { projectId }, nothing); }
  async exportNamed(projectId: Id): Promise<Uint8Array> {
    return Buffer.from(await this.connection.call("export", { projectId }, z.string()), "base64");
  }
  async importPack(projectId: Id, pack: Uint8Array): Promise<void> {
    await this.connection.call("import", { projectId, pack: Buffer.from(pack).toString("base64") }, nothing);
  }
  close(): Promise<void> { return this.connection.close(); }
}

/** Inject this into API processes; only the repository server gets the raw issuer. */
export class RemoteBranchCoordinator implements BranchCoordinator {
  private readonly connection: Connection;
  private readonly listeners = new Set<(scope: Scope) => void>();
  constructor(private readonly options: RepositoryClientOptions) { this.connection = new Connection(options); }
  async acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null> {
    const lease = await this.connection.call("acquire", { scope, owner, ttlMs }, leaseSchema.nullable());
    if (lease) this.notify(scope);
    return lease;
  }
  async renew(lease: BranchLease, ttlMs: number): Promise<BranchLease> {
    const renewed = await this.connection.call("renew", { lease, ttlMs }, leaseSchema);
    this.notify(lease.scope);
    return renewed;
  }
  async release(lease: BranchLease): Promise<void> {
    await this.connection.call("release", { lease }, nothing);
    this.notify(lease.scope);
  }
  assert(tx: Transaction, lease: BranchLease): Promise<void> { return assertRepositoryFence(tx, lease, this.options.clock); }
  subscribe(listener: (scope: Scope) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify(scope: Scope): void { for (const listener of this.listeners) listener(scope); }
  async close(): Promise<void> { await this.connection.close(); this.listeners.clear(); }
}
