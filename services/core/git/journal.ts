import { z } from "zod";
import { IdSchema, ScopeSchema, OperationSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { CoreProjects } from "../base";
import { repositoryPath } from "../base";
import { fail, newId } from "../base/store";
import { run, encode, zero } from "./process";
import { treeInputs, hydrate } from "./trees";

const changeSchema = z.object({
  scope: ScopeSchema, before: z.string(), after: z.string(), hydrate: z.boolean(),
});
const intentSchema = z.object({
  id: IdSchema, actorId: IdSchema, changes: z.array(changeSchema),
  receipt: z.object({ key: z.string(), digest: z.string(), operation: OperationSchema }).optional(),
});
export type RefChange = z.infer<typeof changeSchema>;
export type GitReceipt = NonNullable<z.infer<typeof intentSchema>["receipt"]>;
export class GitJournal {
  constructor(readonly service: CoreProjects) {}
  async publish(actorId: Id, changes: readonly RefChange[], receipt?: GitReceipt) {
    for (const change of changes) if (this.service.context.db.query(
      "SELECT 1 FROM core_git_intents WHERE payload_json LIKE ?").get(`%${change.scope.projectId}%`)) {
      fail("GIT_RECOVERY_PENDING", 409, "Resolve the existing repository intent before another named-ref mutation");
    }
    const id = newId();
    const intent = { id, actorId, changes, ...(receipt ? { receipt } : {}) };
    this.service.context.uow.local(tx => tx.query(
      "INSERT INTO core_git_intents(id,payload_json,created_at) VALUES(?,?,?)")
      .run(id, JSON.stringify(intent), this.service.context.clock.now()));
    await this.finish(intentSchema.parse(intent));
  }
  async finish(intent: z.infer<typeof intentSchema>) {
    const first = intent.changes[0];
    if (!first) fail("EMPTY_INTENT", 500, "Ref intent has no changes");
    const path = repositoryPath(this.service.context, first.scope.projectId);
    const commands: string[] = [];
    for (const change of intent.changes) {
      const actual = await run({ path, args: ["rev-parse", "--verify", `refs/heads/${change.scope.branch}`], allowed: [0, 128] });
      const head = actual.code === 0 ? actual.text : zero;
      if (head === change.after) continue;
      if (head !== change.before) {
        this.service.context.db.query("UPDATE core_git_intents SET state='conflicted' WHERE id=?").run(intent.id);
        fail("REF_CONFLICT", 409, "Named ref changed outside its prepared intent");
      }
      commands.push(change.after === zero
        ? `delete refs/heads/${change.scope.branch} ${change.before}`
        : `update refs/heads/${change.scope.branch} ${change.after} ${change.before}`);
    }
    if (commands.length) await run({ path, args: ["update-ref", "--stdin"],
      input: encode(`start\n${commands.join("\n")}\nprepare\ncommit\n`) });
    for (const change of intent.changes) {
      if (change.after !== zero && change.hydrate) {
        const desiredTree = (await run({ path, args: ["rev-parse", `${change.after}^{tree}`] })).text;
        const existing = this.service.context.db.query<{ tree: string }, [string, string]>(
          "SELECT tree FROM snapshots WHERE project_id=? AND branch=? ORDER BY rowid DESC LIMIT 1")
          .get(change.scope.projectId, change.scope.branch);
        const workspace = this.service.context.db.query("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?")
          .get(change.scope.projectId, change.scope.branch);
        if (!workspace || existing?.tree !== `sha1:${desiredTree}`) await hydrate(this.service, {
          actorId: intent.actorId, scope: change.scope,
          inputs: await treeInputs(this.service, { scope: change.scope, path, commit: change.after }),
        });
      }
    }
    this.service.context.uow.local(tx => {
      for (const change of intent.changes) {
        const previous = tx.query<{ version: number }, [string, string]>(
          "SELECT version FROM branch_heads WHERE project_id=? AND branch=?").get(change.scope.projectId, change.scope.branch);
        if (change.after === zero) {
          tx.query("DELETE FROM branch_heads WHERE project_id=? AND branch=?").run(change.scope.projectId, change.scope.branch);
          tx.query("DELETE FROM branch_workspaces WHERE project_id=? AND branch=?").run(change.scope.projectId, change.scope.branch);
        } else tx.query(`INSERT INTO branch_heads(project_id,branch,head) VALUES(?,?,?)
          ON CONFLICT(project_id,branch) DO UPDATE SET head=excluded.head,version=version+1`)
          .run(change.scope.projectId, change.scope.branch, `sha1:${change.after}`);
        tx.query("DELETE FROM core_git_staging WHERE project_id=? AND branch=?").run(change.scope.projectId, change.scope.branch);
        this.service.context.events.append(tx, { topic: "git.changed", aggregateId: change.scope.projectId,
          payload: { resourceId: change.scope.projectId, version: (previous?.version ?? -1) + 1 } });
      }
      if (intent.receipt) {
        const { key, digest, operation } = intent.receipt;
        const now = this.service.context.clock.now();
        tx.query(`INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
          VALUES(?,?,?,'succeeded',1,?,?,?,?)`).run(operation.id, intent.actorId, operation.kind,
          JSON.stringify(operation.result), key, now, now);
        tx.query("INSERT INTO core_git_receipts(actor_id,key,digest,operation_json) VALUES(?,?,?,?)")
          .run(intent.actorId, key, digest, JSON.stringify(operation));
        this.service.context.events.append(tx, { topic: "operation.changed", aggregateId: operation.id,
          payload: { resourceId: operation.id, status: "succeeded" } });
      }
      tx.query("DELETE FROM core_git_intents WHERE id=?").run(intent.id);
    });
    this.service.context.events.dispatch();
  }
  async recover() {
    const rows = this.service.rows("SELECT payload_json FROM core_git_intents ORDER BY rowid", [], z.object({ payload_json: z.string() }));
    for (const row of rows) await this.finish(intentSchema.parse(JSON.parse(row.payload_json)));
  }
}
