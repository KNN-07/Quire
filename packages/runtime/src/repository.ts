import { z } from "zod";
import { mkdtemp, rm, readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { GitOidSchema } from "@quire/contracts";
import type {
  BranchCoordinator, BranchLease, Clock, Id, RepositoryIntent, RepositoryIntentState,
  RepositoryRefUpdate, RepositoryService, SqlExecutor, Transaction, UnitOfWork, MutationAdmission,
} from "@quire/contracts";
import { StorageError } from "./errors";
import { nativeRepositoryPath, repositoryGit, serializedRepository } from "./repository-process";

type Dependencies = { readonly db: SqlExecutor; readonly uow: UnitOfWork; readonly branches: BranchCoordinator; readonly clock: Clock; readonly admission?: MutationAdmission };
type IntentRow = {
  readonly id: Id; readonly project_id: Id; readonly branch: string; readonly owner: string;
  readonly fence: number; readonly updates_json: string; readonly state: RepositoryIntentState;
};
const updatesSchema = z.array(z.strictObject({
  ref: z.string(), expected: GitOidSchema.nullable(), next: GitOidSchema.nullable(),
})).min(1);
const objectCommands = new Set([
  "hash-object", "mktree", "commit-tree", "cat-file", "ls-tree", "rev-parse",
  "log", "show", "diff", "merge-tree", "for-each-ref",
]);
const readCommands = new Set(["cat-file", "ls-tree", "rev-parse", "log", "show", "diff", "for-each-ref"]);
export class LocalRepositoryService implements RepositoryService {
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly dataDir: string, private readonly deps: Dependencies) {}
  /** Read-only identity of the actual native Git directory, not caller configuration. */
  async restoreIdentity() {
    if (this.closed) throw new StorageError("REPOSITORY_CLOSED", "restore identity");
    const path = await realpath(join(this.dataDir, "git"));
    const metadata = await stat(path, { bigint: true });
    const uid = process.getuid?.();
    if (uid === undefined || metadata.uid !== BigInt(uid) || (metadata.mode & 0o077n) !== 0n) {
      throw new StorageError("REPOSITORY_VOLUME_OWNED", "Git storage must be privately owned");
    }
    return { host: (await readFile("/etc/machine-id", "utf8")).trim(), path,
      device: metadata.dev.toString(), inode: metadata.ino.toString(),
      empty: (await readdir(path)).length === 0 };
  }
  private async queued<T>(projectId: Id, work: (path: string) => Promise<T>): Promise<T> {
    if (this.closed) throw new StorageError("REPOSITORY_CLOSED", projectId);
    const path = nativeRepositoryPath(this.dataDir, projectId);
    const execute = () => serializedRepository(path, () => work(path));
    const result = this.deps.admission ? this.deps.admission.writer(execute) : execute();
    this.pending.add(result);
    try { return await result; } finally { this.pending.delete(result); }
  }
  async initialize(projectId: Id): Promise<void> {
    await this.queued(projectId, async (path) => {
      await repositoryGit(path, ["init", "--bare", "--initial-branch=main", path]);
      await repositoryGit(path, ["config", "transfer.hideRefs", "refs/quire/"]);
      await repositoryGit(path, ["config", "receive.hideRefs", "refs/quire/"]);
      await repositoryGit(path, ["config", "core.fsync", "committed"]);
    });
  }
  async objects(projectId: Id, args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
    if (!args[0] || !objectCommands.has(args[0])) throw new StorageError("REPOSITORY_COMMAND_FORBIDDEN", args[0] ?? "");
    return this.queued(projectId, (path) => repositoryGit(path, args, input));
  }
  async read(projectId: Id, args: readonly string[]): Promise<Uint8Array> {
    if (!args[0] || !readCommands.has(args[0])) throw new StorageError("REPOSITORY_COMMAND_FORBIDDEN", args[0] ?? "");
    return this.queued(projectId, async (path) => {
      await this.assertReadable(projectId);
      return repositoryGit(path, args);
    });
  }
  async publish(intent: RepositoryIntent): Promise<void> {
    const updates = updatesSchema.parse(intent.updates);
    await this.queued(intent.lease.scope.projectId, async (path) => {
      for (const update of updates) await repositoryGit(path, ["check-ref-format", update.ref]);
      await this.deps.uow.run(async (tx) => {
        await this.deps.branches.assert(tx, intent.lease);
        const previous = await tx.get<IntentRow>("SELECT * FROM repository_intents WHERE id=?", [intent.id]);
        if (previous) {
          if (previous.project_id !== intent.lease.scope.projectId || previous.branch !== intent.lease.scope.branch ||
            previous.owner !== intent.lease.owner || previous.fence !== intent.lease.fence ||
            previous.updates_json !== JSON.stringify(updates)) {
            throw new StorageError("REPOSITORY_INTENT_CHANGED", intent.id);
          }
          return;
        }
        await tx.run("INSERT INTO repository_intents(id,project_id,branch,owner,fence,updates_json,state,created_at) VALUES(?,?,?,?,?,?,'prepared',?)",
          [intent.id, intent.lease.scope.projectId, intent.lease.scope.branch, intent.lease.owner,
            intent.lease.fence, JSON.stringify(updates), this.deps.clock.now()]);
      });
      await this.reconcile(path, intent.id, intent.lease);
    });
  }
  async recover(id: Id, lease: BranchLease): Promise<void> {
    await this.queued(lease.scope.projectId, async (path) => {
      await this.deps.uow.run(async (tx) => {
        await this.deps.branches.assert(tx, lease);
        const row = await this.requireIntent(tx, id, lease);
        if (row.state === "conflicted") throw new StorageError("REPOSITORY_REF_CONFLICT", id);
        if (row.state === "finalized") return;
        await tx.run("UPDATE repository_intents SET owner=?,fence=? WHERE id=?", [lease.owner, lease.fence, id]);
      });
      await this.reconcile(path, id, lease);
    });
  }
  private async requireIntent(db: SqlExecutor, id: Id, lease: BranchLease): Promise<IntentRow> {
    const row = await db.get<IntentRow>("SELECT * FROM repository_intents WHERE id=?", [id]);
    if (!row || row.project_id !== lease.scope.projectId || row.branch !== lease.scope.branch) {
      throw new StorageError("REPOSITORY_INTENT_NOT_FOUND", id);
    }
    return row;
  }
  private async reconcile(path: string, id: Id, lease: BranchLease): Promise<void> {
    const row = await this.deps.uow.run(async (tx) => {
      await this.deps.branches.assert(tx, lease);
      return this.requireIntent(tx, id, lease);
    });
    if (row.state === "conflicted") throw new StorageError("REPOSITORY_REF_CONFLICT", id);
    if (row.state === "finalized") return;
    const updates = updatesSchema.parse(JSON.parse(row.updates_json));
    const refs = new TextDecoder().decode(await repositoryGit(path, ["for-each-ref", "--format=%(refname) %(objectname)"]));
    const current = new Map(refs.trim().split("\n").map((line) => {
      const [ref = "", oid = ""] = line.split(" ");
      return [ref, oid];
    }));
    const matches = (update: RepositoryRefUpdate, side: "expected" | "next") =>
      (current.get(update.ref) ?? null) === (update[side]?.split(":")[1] ?? null);
    if (!updates.every((update) => matches(update, "next"))) {
      if (!updates.every((update) => matches(update, "expected"))) {
        await this.deps.db.run("UPDATE repository_intents SET state='conflicted' WHERE id=?", [id]);
        throw new StorageError("REPOSITORY_REF_CONFLICT", id);
      }
      const commands = updates.map((update) => {
        const old = update.expected?.split(":")[1] ?? "0".repeat(update.next?.startsWith("sha256:") ? 64 : 40);
        const next = update.next?.split(":")[1];
        return next ? `update ${update.ref} ${next} ${old}` : `delete ${update.ref} ${old}`;
      });
      await this.deps.uow.run((tx) => this.deps.branches.assert(tx, lease));
      await repositoryGit(path, ["update-ref", "--stdin"], new TextEncoder().encode(
        ["start", ...commands, "prepare", "commit", ""].join("\n"),
      ));
    }
    await this.deps.uow.run(async (tx) => {
      await this.deps.branches.assert(tx, lease);
      await tx.run("UPDATE repository_intents SET state='published' WHERE id=? AND owner=? AND fence=?",
        [id, lease.owner, lease.fence]);
    });
  }
  async finalize(tx: Transaction, id: Id, lease: BranchLease): Promise<void> {
    await this.deps.branches.assert(tx, lease);
    const row = await this.requireIntent(tx, id, lease);
    if (row.owner !== lease.owner || row.fence !== lease.fence ||
      (row.state !== "published" && row.state !== "finalized")) {
      throw new StorageError("REPOSITORY_NOT_PUBLISHED", id);
    }
    await tx.run("UPDATE repository_intents SET state='finalized' WHERE id=?", [id]);
  }
  async assertReadable(projectId: Id): Promise<void> {
    const pending = await this.deps.db.get("SELECT id FROM repository_intents WHERE project_id=? AND state<>'finalized'", [projectId]);
    if (pending) throw new StorageError("REPOSITORY_NOT_FINALIZED", projectId);
  }
  async exportNamed(projectId: Id): Promise<Uint8Array> {
    return this.queued(projectId, async (source) => {
      await this.assertReadable(projectId);
      const refs = new TextDecoder().decode(await repositoryGit(source,
        ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/"])).trim();
      if (!refs) return new Uint8Array();
      const temp = await mkdtemp(join(this.dataDir, "work", "public-"));
      const path = join(temp, "public.git");
      try {
        await repositoryGit(path, ["init", "--bare", path]);
        const entries = refs.split("\n").map((line) => line.split(" "));
        await repositoryGit(path, ["fetch", "--no-tags", "--no-write-fetch-head", source,
          ...entries.map((entry) => entry[1] ?? "")]);
        await repositoryGit(path, ["update-ref", "--stdin"], new TextEncoder().encode(
          entries.map(([ref, oid]) => `create ${ref} ${oid}\n`).join("")));
        return await repositoryGit(path, ["bundle", "create", "-", "--branches"]);
      } finally { await rm(temp, { recursive: true, force: true }); }
    });
  }
  async importPack(projectId: Id, pack: Uint8Array): Promise<void> {
    await this.queued(projectId, async (canonical) => {
      const temp = await mkdtemp(join(this.dataDir, "work", "quarantine-"));
      const path = join(temp, "objects.git");
      try {
        await repositoryGit(path, ["init", "--bare", path]);
        await repositoryGit(path, ["index-pack", "--stdin", "--strict"], pack);
        await repositoryGit(path, ["fsck", "--strict", "--no-reflogs"]);
        await repositoryGit(canonical, ["index-pack", "--stdin", "--strict"], pack);
      } finally { await rm(temp, { recursive: true, force: true }); }
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.pending);
  }
}
