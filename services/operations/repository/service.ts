import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { IdSchema } from "@quire/contracts";
import type {
  BranchCoordinator, BranchLease, Clock, Id, RepositoryIntent, RepositoryRefUpdate, Scope,
  SqlExecutor, UnitOfWork,
} from "@quire/contracts";
import { StorageError } from "@quire/runtime";
import { intentSchema, requireIntent, updatesSchema } from "./journal";
import type { IntentRow } from "./journal";
import type { GitRunner } from "./process";

export type RepositoryDependencies = {
  readonly db: SqlExecutor; readonly uow: UnitOfWork; readonly branches: BranchCoordinator; readonly clock: Clock;
};
const objectCommands = new Set(["hash-object", "mktree", "commit-tree", "cat-file", "ls-tree",
  "rev-parse", "log", "show", "diff", "merge-tree", "for-each-ref"]);
const readCommands = new Set(["cat-file", "ls-tree", "rev-parse", "log", "show", "diff", "for-each-ref"]);
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes).trim();

/** One instance per exclusively locked volume; never instantiate in API processes. */
export class RepositoryEngine {
  private readonly queues = new Map<Id, Promise<void>>();
  private closed = false;
  constructor(private readonly volume: string, private readonly deps: RepositoryDependencies, private readonly git: GitRunner) {}
  private path(project: Id): string { return join(this.volume, `${IdSchema.parse(project)}.git`); }
  private async queued<T>(project: Id, work: () => Promise<T>): Promise<T> {
    if (this.closed) throw new StorageError("REPOSITORY_CLOSED", project);
    const result = (this.queues.get(project) ?? Promise.resolve()).then(work);
    const settled = result.then(() => undefined, () => undefined);
    this.queues.set(project, settled);
    try { return await result; }
    finally { if (this.queues.get(project) === settled) this.queues.delete(project); }
  }
  acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null> {
    return this.queued(scope.projectId, () => this.deps.branches.acquire(scope, owner, ttlMs));
  }
  renew(lease: BranchLease, ttlMs: number): Promise<BranchLease> {
    return this.queued(lease.scope.projectId, () => this.deps.branches.renew(lease, ttlMs));
  }
  release(lease: BranchLease): Promise<void> {
    return this.queued(lease.scope.projectId, () => this.deps.branches.release(lease));
  }
  async initialize(project: Id): Promise<void> {
    await this.queued(project, async () => {
      const path = this.path(project);
      await this.git(path, ["init", "--bare", "--initial-branch=main", path]);
      for (const [key, value] of [
        ["transfer.hideRefs", "refs/quire/"], ["receive.hideRefs", "refs/quire/"],
        ["uploadpack.allowAnySHA1InWant", "false"], ["uploadpack.allowReachableSHA1InWant", "false"],
        ["core.fsync", "committed"], ["receive.fsckObjects", "true"],
      ]) if (key && value) await this.git(path, ["config", key, value]);
    });
  }
  private command(args: readonly string[], allowed: ReadonlySet<string>): void {
    if (!args[0] || !allowed.has(args[0]) || args.some((arg) =>
      arg.includes("\0") || /^(--output(?:=|$)|--git-dir(?:=|$)|--work-tree(?:=|$)|--exec-path(?:=|$))/.test(arg))) {
      throw new StorageError("REPOSITORY_COMMAND_FORBIDDEN", args[0] ?? "");
    }
  }
  objects(project: Id, args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
    this.command(args, objectCommands);
    return this.queued(project, () => this.git(this.path(project), args, input));
  }
  read(project: Id, args: readonly string[]): Promise<Uint8Array> {
    this.command(args, readCommands);
    return this.queued(project, async () => {
      await this.readable(project);
      return this.git(this.path(project), args);
    });
  }
  private async readable(project: Id): Promise<void> {
    if (await this.deps.db.get("SELECT id FROM repository_intents WHERE project_id=? AND state<>'finalized'", [project])) {
      throw new StorageError("REPOSITORY_NOT_FINALIZED", project);
    }
  }
  assertReadable(project: Id): Promise<void> { return this.queued(project, () => this.readable(project)); }
  async publish(input: RepositoryIntent): Promise<void> {
    const intent = intentSchema.parse(input);
    await this.queued(intent.lease.scope.projectId, async () => {
      const path = this.path(intent.lease.scope.projectId);
      const names = new Set<string>();
      for (const update of intent.updates) {
        if ((!update.ref.startsWith("refs/heads/") && !update.ref.startsWith("refs/quire/")) || names.has(update.ref)) {
          throw new StorageError("REPOSITORY_REF_FORBIDDEN", update.ref);
        }
        names.add(update.ref);
        await this.git(path, ["check-ref-format", update.ref]);
      }
      await this.deps.uow.run(async (tx) => {
        await this.deps.branches.assert(tx, intent.lease);
        const previous = await tx.get<IntentRow>("SELECT * FROM repository_intents WHERE id=?", [intent.id]);
        if (previous) {
          if (previous.project_id !== intent.lease.scope.projectId || previous.branch !== intent.lease.scope.branch ||
            previous.owner !== intent.lease.owner || previous.fence !== intent.lease.fence ||
            previous.updates_json !== JSON.stringify(intent.updates)) throw new StorageError("REPOSITORY_INTENT_CHANGED", intent.id);
          return;
        }
        if (await tx.get("SELECT id FROM repository_intents WHERE project_id=? AND state<>'finalized'", [intent.lease.scope.projectId])) {
          throw new StorageError("REPOSITORY_RECOVERY_REQUIRED", intent.lease.scope.projectId);
        }
        await tx.run("INSERT INTO repository_intents(id,project_id,branch,owner,fence,updates_json,state,created_at) VALUES(?,?,?,?,?,?,'prepared',?)",
          [intent.id, intent.lease.scope.projectId, intent.lease.scope.branch, intent.lease.owner,
            intent.lease.fence, JSON.stringify(intent.updates), this.deps.clock.now()]);
      });
      await this.reconcile(path, intent.id, intent.lease);
    });
  }
  async recover(id: Id, lease: BranchLease): Promise<void> {
    await this.queued(lease.scope.projectId, async () => {
      await this.deps.uow.run(async (tx) => {
        await this.deps.branches.assert(tx, lease);
        const row = await requireIntent(tx, id, lease);
        if (row.state === "conflicted") throw new StorageError("REPOSITORY_REF_CONFLICT", id);
        if (row.state !== "finalized") await tx.run("UPDATE repository_intents SET owner=?,fence=? WHERE id=?", [lease.owner, lease.fence, id]);
      });
      await this.reconcile(this.path(lease.scope.projectId), id, lease);
    });
  }
  private async reconcile(path: string, id: Id, lease: BranchLease): Promise<void> {
    const row = await this.deps.uow.run(async (tx) => {
      await this.deps.branches.assert(tx, lease);
      return requireIntent(tx, id, lease);
    });
    if (row.state === "finalized") return;
    if (row.state === "conflicted") throw new StorageError("REPOSITORY_REF_CONFLICT", id);
    const updates = updatesSchema.parse(JSON.parse(row.updates_json));
    const refs = decode(await this.git(path, ["for-each-ref", "--format=%(refname) %(objectname)"]));
    const current = new Map(refs.split("\n").map((line) => {
      const [ref = "", oid = ""] = line.split(" ");
      return [ref, oid];
    }));
    const matches = (update: RepositoryRefUpdate, side: "expected" | "next") =>
      (current.get(update.ref) ?? null) === (update[side]?.split(":")[1] ?? null);
    if (!updates.every((update) => matches(update, "next"))) {
      if (!updates.every((update) => matches(update, "expected"))) {
        await this.deps.uow.run(async (tx) => {
          await this.deps.branches.assert(tx, lease);
          await tx.run("UPDATE repository_intents SET state='conflicted' WHERE id=?", [id]);
        });
        throw new StorageError("REPOSITORY_REF_CONFLICT", id);
      }
      const commands = updates.map((update) => {
        const old = update.expected?.split(":")[1] ?? "0".repeat(update.next?.startsWith("sha256:") ? 64 : 40);
        return update.next ? `update ${update.ref} ${update.next.split(":")[1]} ${old}` : `delete ${update.ref} ${old}`;
      });
      // No takeover can enter the service queue between this check and child exit.
      await this.deps.uow.run((tx) => this.deps.branches.assert(tx, lease));
      await this.git(path, ["update-ref", "--stdin"], encode(["start", ...commands, "prepare", "commit", ""].join("\n")));
    }
    await this.deps.uow.run(async (tx) => {
      await this.deps.branches.assert(tx, lease);
      await tx.run("UPDATE repository_intents SET state='published' WHERE id=? AND owner=? AND fence=?", [id, lease.owner, lease.fence]);
    });
  }
  /** Only finalized named ancestry enters this physically separate object database. */
  exportNamed(project: Id): Promise<Uint8Array> {
    return this.queued(project, async () => {
      await this.readable(project);
      const source = this.path(project);
      const refs = decode(await this.git(source, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/"]));
      if (!refs) return new Uint8Array();
      const temp = await mkdtemp(join(this.volume, ".public-"));
      const path = join(temp, "public.git");
      try {
        await this.git(path, ["init", "--bare", path]);
        const entries = refs.split("\n").map((line) => line.split(" "));
        await this.git(path, ["fetch", "--no-tags", "--no-write-fetch-head", source,
          ...entries.map((entry) => entry[1] ?? "")]);
        await this.git(path, ["update-ref", "--stdin"], encode(entries.map(([ref, oid]) => `create ${ref} ${oid}\n`).join("")));
        return await this.git(path, ["bundle", "create", "-", "--branches"]);
      } finally { await rm(temp, { recursive: true, force: true }); }
    });
  }
  /** Validate pack in isolation; import immutable objects only, never refs or hooks. */
  importPack(project: Id, pack: Uint8Array): Promise<void> {
    return this.queued(project, async () => {
      const temp = await mkdtemp(join(this.volume, ".quarantine-"));
      const path = join(temp, "objects.git");
      try {
        await this.git(path, ["init", "--bare", path]);
        await this.git(path, ["index-pack", "--stdin", "--strict"], pack);
        await this.git(path, ["fsck", "--strict", "--no-reflogs"]);
        await this.git(this.path(project), ["index-pack", "--stdin", "--strict"], pack);
      } finally { await rm(temp, { recursive: true, force: true }); }
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.queues.values());
  }
}
