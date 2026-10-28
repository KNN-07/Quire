import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import { createRuntime } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import type { Id, GitOid, RepositoryIntent } from "@quire/contracts";
import { fixture, fixedClock } from "./fixture";

async function commit(runtime: Runtime, project: Id, message: string): Promise<GitOid> {
  const tree = new TextDecoder().decode(await runtime.repositories.objects(project, ["mktree"], new Uint8Array())).trim();
  const oid = new TextDecoder().decode(await runtime.repositories.objects(project, ["commit-tree", tree, "-m", message])).trim();
  return GitOidSchema.parse(`sha1:${oid}`);
}

test("real Git CAS stays hidden until atomic SQL finalization; stale fences cannot publish", async () => {
  const time = fixedClock();
  const f = await fixture({ clock: time.clock });
  try {
    const projectId = IdSchema.parse(crypto.randomUUID());
    const scope = { projectId, branch: "main" };
    await f.runtime.repositories.initialize(projectId);
    const next = await commit(f.runtime, projectId, "first");
    const lease = await f.runtime.branches.acquire(scope, "first", 1000);
    if (!lease) throw new Error("Lease unavailable");
    const intent: RepositoryIntent = {
      id: IdSchema.parse(crypto.randomUUID()), lease,
      updates: [{ ref: "refs/heads/main", expected: null, next }],
    };
    await f.runtime.repositories.publish(intent);
    await f.runtime.repositories.publish(intent);
    await rejects(f.runtime.repositories.assertReadable(projectId), { code: "REPOSITORY_NOT_FINALIZED" });
    await rejects(f.runtime.repositories.read(projectId, ["rev-parse", "refs/heads/main"]), { code: "REPOSITORY_NOT_FINALIZED" });
    await f.runtime.db.exec("CREATE TABLE receipt(id TEXT PRIMARY KEY) STRICT");
    await rejects(f.runtime.uow.run(async (tx) => {
      await tx.run("INSERT INTO receipt VALUES(?)", [intent.id]);
      await f.runtime.repositories.finalize(tx, intent.id, lease);
      throw new Error("rollback finalization");
    }), /rollback finalization/);
    expect(await f.runtime.db.all("SELECT * FROM receipt")).toEqual([]);
    expect(await f.runtime.db.get<{ state: string }>("SELECT state FROM repository_intents WHERE id=?", [intent.id])).toEqual({ state: "published" });
    await f.runtime.uow.run(async (tx) => {
      await tx.run("INSERT INTO receipt VALUES(?)", [intent.id]);
      await f.runtime.repositories.finalize(tx, intent.id, lease);
    });
    await f.runtime.repositories.assertReadable(projectId);
    expect(new TextDecoder().decode(await f.runtime.repositories.read(projectId, ["rev-parse", "refs/heads/main"])).trim())
      .toBe(next.slice(5));
    time.advance(1000);
    const successor = await f.runtime.branches.acquire(scope, "second", 1000);
    expect(successor?.fence).toBe(lease.fence + 1);
    await rejects(f.runtime.repositories.publish({
      id: IdSchema.parse(crypto.randomUUID()), lease, updates: [{ ref: "refs/heads/other", expected: null, next }],
    }), { code: "STALE_BRANCH_FENCE" });
    await rejects(f.runtime.repositories.objects(projectId, ["update-ref", "refs/heads/other", next.slice(5)]),
      { code: "REPOSITORY_COMMAND_FORBIDDEN" });
  } finally { await f.close(); }
});

test("restart recovery adopts the new fence and reconciles a published but unfinished ref", async () => {
  const time = fixedClock();
  const f = await fixture({ clock: time.clock });
  let reopened: Runtime | undefined;
  try {
    const projectId = IdSchema.parse(crypto.randomUUID());
    const scope = { projectId, branch: "main" };
    await f.runtime.repositories.initialize(projectId);
    const next = await commit(f.runtime, projectId, "recover me");
    const first = await f.runtime.branches.acquire(scope, "dead-process", 1000);
    if (!first) throw new Error("Lease unavailable");
    const id = IdSchema.parse(crypto.randomUUID());
    await f.runtime.repositories.publish({ id, lease: first, updates: [{ ref: "refs/heads/main", expected: null, next }] });
    await f.runtime.close();
    time.advance(1000);
    reopened = await createRuntime(f.runtime.config, { clock: time.clock });
    const second = await reopened.branches.acquire(scope, "recovery", 1000);
    if (!second) throw new Error("Recovery lease unavailable");
    await rejects(reopened.repositories.assertReadable(projectId), { code: "REPOSITORY_NOT_FINALIZED" });
    await reopened.repositories.recover(id, second);
    const active = reopened;
    await rejects(active.uow.run((tx) => active.repositories.finalize(tx, id, first)), { code: "STALE_BRANCH_FENCE" });
    await active.uow.run((tx) => active.repositories.finalize(tx, id, second));
    await active.repositories.assertReadable(projectId);
    expect(await active.db.get<{ state: string; fence: number }>("SELECT state,fence FROM repository_intents WHERE id=?", [id]))
      .toEqual({ state: "finalized", fence: second.fence });
  } finally { if (reopened) await reopened.close(); await f.close(); }
});

test("unexpected real refs durably conflict rather than overwrite or expose an unfinished intent", async () => {
  const f = await fixture();
  try {
    const projectId = IdSchema.parse(crypto.randomUUID());
    await f.runtime.repositories.initialize(projectId);
    const next = await commit(f.runtime, projectId, "conflict");
    const lease = await f.runtime.branches.acquire({ projectId, branch: "main" }, "writer", 60000);
    if (!lease) throw new Error("Lease unavailable");
    const id = IdSchema.parse(crypto.randomUUID());
    await rejects(f.runtime.repositories.publish({
      id, lease, updates: [{ ref: "refs/heads/main", expected: next, next: GitOidSchema.parse(`sha1:${"1".repeat(40)}`) }],
    }), { code: "REPOSITORY_REF_CONFLICT" });
    expect(await f.runtime.db.get<{ state: string }>("SELECT state FROM repository_intents WHERE id=?", [id])).toEqual({ state: "conflicted" });
    await rejects(f.runtime.repositories.recover(id, lease), { code: "REPOSITORY_REF_CONFLICT" });
    await rejects(f.runtime.repositories.assertReadable(projectId), { code: "REPOSITORY_NOT_FINALIZED" });
    expect(new TextDecoder().decode(await f.runtime.repositories.objects(projectId, ["for-each-ref"])).trim()).toBe("");
  } finally { await f.close(); }
});
