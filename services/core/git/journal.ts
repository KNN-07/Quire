import { z } from "zod";
import { IdSchema, ScopeSchema, OperationSchema, InstantSchema } from "@quire/contracts";
import type { BranchLease, Id, Transaction, RepositoryRefUpdate } from "@quire/contracts";
import type { CoreProjects, SourceIntent } from "../base";
import { sourceIntent } from "../base";
import { writeCheckpoint } from "../base/git-checkpoint";
import { fail, newId, compare } from "../base/store";
import { objects, oid, zero } from "./process";
import { treeInputs } from "./trees";

const changeSchema = z.object({
  scope: ScopeSchema, before: z.string(), after: z.string(), hydrate: z.boolean(),
});
const leaseSchema = z.object({
  scope: ScopeSchema, owner: z.string(), fence: z.number(), expiresAt: InstantSchema,
});
const intentSchema = z.object({
  id: IdSchema, actorId: IdSchema, changes: z.array(changeSchema).min(1),
  leases: z.array(leaseSchema).optional(),
  revisions: z.array(z.number().nullable()).optional(),
  sources: z.array(sourceIntent).optional(),
  tokenHash: z.string().optional(),
  sshFingerprint: z.string().optional(),
  initial: z.boolean().optional(),
  receipt: z.object({ key: z.string(), digest: z.string(), operation: OperationSchema }).optional(),
});
type Intent = z.infer<typeof intentSchema>;
export type RefChange = z.infer<typeof changeSchema>;
export type GitReceipt = NonNullable<Intent["receipt"]>;

export class GitJournal {
  constructor(readonly service: CoreProjects) {}
  private async authorize(tx: Transaction, actorId: Id, change: RefChange, initial = false) {
    const service = this.service.withTransaction(tx);
    const exists = await tx.get("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?",
      [change.scope.projectId, change.scope.branch]);
    const project = await service.getProject(change.scope.projectId);
    if (initial && (change.before !== zero || change.after === zero || change.hydrate || change.scope.branch !== project.defaultBranch)) {
      fail("INVALID_INITIAL_REF", 500, "Read initialization may only create the default named root");
    }
    await service.authorize(actorId, exists ? change.scope : { ...change.scope, branch: project.defaultBranch },
      initial ? "git.read" : "git.write");
  }
  private lease(change: Pick<RefChange, "scope">, leases: readonly BranchLease[]) {
    const lease = leases.find(item => item.scope.projectId === change.scope.projectId && item.scope.branch === change.scope.branch);
    if (!lease) fail("GIT_LEASE_REQUIRED", 500, "Every changed branch requires its current fence");
    return lease;
  }
  private async credential(tx: Transaction, actorId: Id, authorization: {
    readonly tokenHash?: string;
    readonly sshFingerprint?: string;
  }) {
    const { tokenHash, sshFingerprint } = authorization;
    if (tokenHash && sshFingerprint) fail("INVALID_GIT_CREDENTIAL", 500, "Git intent has multiple credentials");
    if (tokenHash && !await tx.get("SELECT id FROM git_tokens WHERE token_hash=? AND user_id=? AND expires_at>?",
      [tokenHash, actorId, this.service.context.clock.now()])) {
      fail("GIT_AUTH_REQUIRED", 401, "Current Git token required");
    }
    if (sshFingerprint && !await tx.get(`SELECT k.id FROM ssh_keys k JOIN users u ON u.id=k.user_id
      WHERE k.fingerprint=? AND k.user_id=? AND u.suspended=0 AND u.deleted_at IS NULL`, [sshFingerprint, actorId])) {
      fail("GIT_AUTH_REQUIRED", 401, "Current SSH key required");
    }
  }
  private async prepare(actorId: Id, changes: readonly RefChange[], leases: readonly BranchLease[]): Promise<SourceIntent[]> {
    const sources: SourceIntent[] = [];
    for (const change of changes) {
      if (change.after === zero || !change.hydrate) continue;
      const branch = await this.service.context.db.get<{ revision: number }>(
        "SELECT revision FROM branch_workspaces WHERE project_id=? AND branch=?", [change.scope.projectId, change.scope.branch]);
      const desiredTree = (await objects(this.service, change.scope, ["rev-parse", `${change.after}^{tree}`])).text;
      const currentTree = branch ? (await writeCheckpoint(this.service.context, change.scope.projectId,
        await this.service.listFiles(change.scope))).tree : null;
      if (currentTree === `sha1:${desiredTree}`) continue;
      const source = await this.service.prepareSource({
        actorId, scope: change.scope, lease: this.lease(change, leases), expectedRevision: branch?.revision ?? 0,
        inputs: await treeInputs(this.service, { scope: change.scope, commit: change.after }),
        reason: "commit", ...(!branch ? { newBranchId: newId() } : {}),
      });
      if (source.snapshot.tree !== `sha1:${desiredTree}`) fail("GIT_SOURCE_TREE_MISMATCH", 409, "Prepared browser source must match the named tree");
      sources.push(source);
    }
    return sources;
  }
  async publish(actorId: Id, changes: readonly RefChange[], leases: readonly BranchLease[], receipt?: GitReceipt,
    authorization: { readonly tokenHash?: string; readonly sshFingerprint?: string; readonly initial?: boolean } = {}) {
    if (!changes.length) fail("EMPTY_INTENT", 500, "Ref intent has no changes");
    const { tokenHash, sshFingerprint, initial = false } = authorization;
    if (initial && (changes.length !== 1 || receipt)) fail("INVALID_INITIAL_REF", 500, "Read initialization cannot contain other named mutations");
    const id = newId();
    const context = this.service.context;
    const sources = await this.prepare(actorId, changes, leases);
    const intent = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.credential(tx, actorId, {
        ...(tokenHash ? { tokenHash } : {}),
        ...(sshFingerprint ? { sshFingerprint } : {}),
      });
      for (const change of changes) {
        await context.branches.assert(tx, this.lease(change, leases));
        await this.authorize(tx, actorId, change, initial);
      }
      const pending = await tx.all<{ payload_json: string }>("SELECT payload_json FROM core_git_intents");
      if (pending.some(row => intentSchema.parse(JSON.parse(row.payload_json)).changes.some(
        change => changes.some(next => next.scope.projectId === change.scope.projectId)))) {
        fail("GIT_RECOVERY_PENDING", 409, "Resolve the existing repository intent before another named-ref mutation");
      }
      const revisions = await Promise.all(changes.map(async change => {
        const branch = await tx.get<{ revision: number }>("SELECT revision FROM branch_workspaces WHERE project_id=? AND branch=?",
          [change.scope.projectId, change.scope.branch]);
        return branch?.revision ?? null;
      }));
      for (const source of sources) {
        const index = changes.findIndex(change => change.scope.branch === source.snapshot.scope.branch);
        compare(revisions[index] ?? 0, source.previousRevision);
        if (source.projectVersion !== undefined) {
          compare((await this.service.withTransaction(tx).getProject(source.snapshot.scope.projectId)).version, source.projectVersion);
        }
      }
      const prepared = intentSchema.parse({ id, actorId, changes, leases, revisions, sources, initial,
        ...(receipt ? { receipt } : {}), ...(tokenHash ? { tokenHash } : {}),
        ...(sshFingerprint ? { sshFingerprint } : {}) });
      await tx.run("INSERT INTO core_git_intents(id,payload_json,created_at) VALUES(?,?,?)",
        [id, JSON.stringify(prepared), context.clock.now()]);
      return prepared;
    });
    await this.finish(intent, leases);
  }
  async finish(persisted: Intent, leases: readonly BranchLease[]) {
    const context = this.service.context;
    const intent = { ...persisted, sources: persisted.sources ?? await this.prepare(persisted.actorId, persisted.changes, leases) };
    const first = intent.changes[0];
    if (!first) fail("EMPTY_INTENT", 500, "Ref intent has no changes");
    const primary = this.lease(first, leases);
    await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.credential(tx, intent.actorId, {
        ...(intent.tokenHash ? { tokenHash: intent.tokenHash } : {}),
        ...(intent.sshFingerprint ? { sshFingerprint: intent.sshFingerprint } : {}),
      });
      for (const change of intent.changes) {
        await context.branches.assert(tx, this.lease(change, leases));
        await this.authorize(tx, intent.actorId, change, intent.initial);
      }
      await tx.run("UPDATE core_git_intents SET payload_json=? WHERE id=?", [JSON.stringify({ ...intent, leases }), intent.id]);
    });
    try {
      if (await context.db.get("SELECT id FROM repository_intents WHERE id=?", [intent.id])) {
        await context.repositories.recover(intent.id, primary);
      } else {
        const updates: RepositoryRefUpdate[] = [];
        for (const change of intent.changes) {
          const current = (await objects(this.service, change.scope,
            ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/"])).text.split("\n")
            .find(row => row.startsWith(`refs/heads/${change.scope.branch} `))?.split(" ")[1] ?? zero;
          if (current !== change.before && current !== change.after) {
            await context.db.run("UPDATE core_git_intents SET state='conflicted' WHERE id=?", [intent.id]);
            fail("REF_CONFLICT", 409, "Named ref changed outside its prepared intent");
          }
          updates.push({ ref: `refs/heads/${change.scope.branch}`,
            expected: current === zero ? null : oid(current), next: change.after === zero ? null : oid(change.after) });
        }
        for (const source of intent.sources) updates.push({
          ref: `refs/quire/history/${source.snapshot.id}`, expected: null, next: oid(source.commit),
        });
        await context.repositories.publish({
          id: intent.id, lease: primary, updates,
        });
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "REPOSITORY_REF_CONFLICT") {
        await context.db.run("UPDATE core_git_intents SET state='conflicted' WHERE id=?", [intent.id]);
        fail("REF_CONFLICT", 409, "Named ref changed outside its prepared intent");
      }
      throw error;
    }
    await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.credential(tx, intent.actorId, {
        ...(intent.tokenHash ? { tokenHash: intent.tokenHash } : {}),
        ...(intent.sshFingerprint ? { sshFingerprint: intent.sshFingerprint } : {}),
      });
      for (const [index, change] of intent.changes.entries()) {
        await context.branches.assert(tx, this.lease(change, leases));
        await this.authorize(tx, intent.actorId, change, intent.initial);
        const branch = await tx.get<{ revision: number }>("SELECT revision FROM branch_workspaces WHERE project_id=? AND branch=?",
          [change.scope.projectId, change.scope.branch]);
        const revision = intent.revisions?.[index];
        if (branch && revision !== null && revision !== undefined) compare(branch.revision, revision);
        if (!branch && revision !== null && revision !== undefined) fail("STALE_VERSION", 409, "Prepared source branch no longer exists");
      }
      const sourceEvents = await this.service.finalizePreparedSources(tx, {
        publication: { id: intent.id, lease: primary },
        sources: intent.sources.map(source => ({
          source, lease: this.lease({ scope: source.snapshot.scope }, leases),
        })),
      });
      const versions: number[] = [];
      for (const change of intent.changes) {
        const parameters = [change.scope.projectId, change.scope.branch];
        const previous = await tx.get<{ version: number }>("SELECT version FROM branch_heads WHERE project_id=? AND branch=?", parameters);
        versions.push((previous?.version ?? -1) + 1);
        if (change.after === zero) {
          await tx.run("DELETE FROM branch_heads WHERE project_id=? AND branch=?", parameters);
          await tx.run("DELETE FROM branch_workspaces WHERE project_id=? AND branch=?", parameters);
        } else await tx.run(`INSERT INTO branch_heads(project_id,branch,head) VALUES(?,?,?)
          ON CONFLICT(project_id,branch) DO UPDATE SET head=excluded.head,version=branch_heads.version+1`,
        [...parameters, `sha1:${change.after}`]);
        await tx.run("DELETE FROM core_git_staging WHERE project_id=? AND branch=?", parameters);
      }
      if (intent.receipt) {
        const { key, digest, operation } = intent.receipt;
        const now = context.clock.now();
        await tx.run(`INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
          VALUES(?,?,?,'succeeded',1,?,?,?,?)`, [operation.id, intent.actorId, operation.kind,
          JSON.stringify(operation.result), key, now, now]);
        await tx.run("INSERT INTO core_git_receipts(actor_id,key,digest,operation_json) VALUES(?,?,?,?)",
          [intent.actorId, key, digest, JSON.stringify(operation)]);
      }
      await tx.run("DELETE FROM core_git_intents WHERE id=?", [intent.id]);
      for (const event of sourceEvents) await context.events.record(tx, event);
      for (const [index, change] of intent.changes.entries()) {
        await context.events.record(tx, { topic: "git.changed", aggregateId: change.scope.projectId,
          payload: { resourceId: change.scope.projectId, version: versions[index] ?? 0 } });
      }
      if (intent.receipt) await context.events.record(tx, {
        topic: "operation.changed", aggregateId: intent.receipt.operation.id,
        payload: { resourceId: intent.receipt.operation.id, status: "succeeded" },
      });
    });
    await context.events.dispatch();
  }
  async recover() {
    const rows = await this.service.rows("SELECT payload_json,state FROM core_git_intents ORDER BY created_at,id", [],
      z.object({ payload_json: z.string(), state: z.string() }));
    for (const row of rows) {
      if (row.state === "conflicted") fail("REF_CONFLICT", 409, "Repository intent requires conflict resolution");
      const intent = intentSchema.parse(JSON.parse(row.payload_json));
      const scopes = [...intent.changes].sort((a, b) => a.scope.branch.localeCompare(b.scope.branch));
      const acquire = async (index: number, leases: readonly BranchLease[]): Promise<void> => {
        const change = scopes[index];
        if (!change) return this.finish(intent, leases);
        return this.service.serialized(change.scope, lease => acquire(index + 1, [...leases, lease]));
      };
      await acquire(0, []);
    }
  }
}
