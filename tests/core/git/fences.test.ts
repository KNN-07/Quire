import { expect, test } from "bun:test";
import { InstantSchema, OperationSchema } from "@quire/contracts";
import { GitRepository, credentialHash } from "../../../services/core/git";
import { raw, objects } from "../../../services/core/git/process";
import { gitFixture } from "./harness";

test("T11 expired named writer cannot prepare metadata or publish its ref", async () => {
  let now = "2026-10-27T00:00:00.000Z";
  await using fixture = await gitFixture({ clock: { now: () => InstantSchema.parse(now) } });
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const scope = { projectId: project.id, branch: "main" };
  const repo = new GitRepository(fixture.service());
  const tree = (await objects(repo.service, scope, ["rev-parse", "main^{tree}"])).text;
  const after = await repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: "Stale writer" });
  const stale = await fixture.runtime.branches.acquire(scope, "stale-git-writer", 1);
  if (!stale) throw new TypeError("Expected initial fence");
  now = "2026-10-27T00:00:00.002Z";
  const current = await fixture.runtime.branches.acquire(scope, "current-git-writer", 60_000);
  if (!current) throw new TypeError("Expected replacement fence");
  try {
    const rejected = await repo.journal.publish(owner.user.id,
      [{ scope, before: raw(before.head), after, hydrate: false }], [stale]).then(() => null, (error: unknown) => error);
    expect(rejected).toMatchObject({ code: "STALE_BRANCH_FENCE" });
    expect(await fixture.runtime.db.all("SELECT id FROM core_git_intents")).toHaveLength(0);
    expect((await objects(repo.service, scope, ["rev-parse", "main"])).text).toBe(raw(before.head));
    expect(current.fence).toBeGreaterThan(stale.fence);
  } finally { await fixture.runtime.branches.release(current); }
});

test("T11 named finalization rollback keeps publication hidden and recovers its original receipt", async () => {
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const scope = { projectId: project.id, branch: "main" };
  const repo = new GitRepository(fixture.service());
  const tree = (await objects(repo.service, scope, ["rev-parse", "main^{tree}"])).text;
  const after = await repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: "Recover rollback" });
  const receipt = { key: crypto.randomUUID(), digest: "rollback-test", operation: OperationSchema.parse({
    id: crypto.randomUUID(), kind: "git-commit", status: "succeeded", progress: 1, result: { head: `sha1:${after}` }, errorCode: null,
  }) };
  const record = fixture.runtime.events.record.bind(fixture.runtime.events);
  fixture.runtime.events.record = async (tx, event) => {
    if (event.topic === "git.changed") throw new Error("injected-git-finalization");
    return record(tx, event);
  };
  try {
    const failure = await repo.service.serialized(scope, lease => repo.journal.publish(owner.user.id,
      [{ scope, before: raw(before.head), after, hydrate: false }], [lease], receipt)).then(() => null, (error: unknown) => error);
    expect(failure).toMatchObject({ message: "injected-git-finalization" });
  } finally { fixture.runtime.events.record = record; }
  expect(await fixture.runtime.db.all("SELECT id FROM core_git_intents")).toHaveLength(1);
  expect(await fixture.runtime.db.all("SELECT key FROM core_git_receipts")).toHaveLength(0);
  expect(await fixture.runtime.db.get("SELECT head FROM branch_heads WHERE project_id=? AND branch=?", [project.id, "main"]))
    .toMatchObject({ head: before.head });
  const hidden = await fixture.runtime.repositories.read(project.id, ["rev-parse", "main"])
    .then(() => null, (error: unknown) => error);
  expect(hidden).toMatchObject({ code: "REPOSITORY_NOT_FINALIZED" });
  await fixture.restart();
  expect((await fixture.status(owner.headers, project.id)).head).toBe(`sha1:${after}`);
  expect(await fixture.runtime.db.all("SELECT id FROM core_git_intents")).toHaveLength(0);
  expect(await fixture.runtime.db.get("SELECT operation_json FROM core_git_receipts WHERE actor_id=? AND key=?",
    [owner.user.id, receipt.key])).toMatchObject({ operation_json: JSON.stringify(receipt.operation) });
});

test("T11 token revoked after CAS cannot finalize named metadata or become readable", async () => {
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const token = await fixture.token(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const repo = new GitRepository(fixture.service());
  const tree = (await objects(repo.service, scope, ["rev-parse", "main^{tree}"])).text;
  const after = await repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: "Revoked during publication" });
  const publish = fixture.runtime.repositories.publish.bind(fixture.runtime.repositories);
  fixture.runtime.repositories.publish = async intent => {
    await publish(intent);
    await fixture.runtime.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.run("DELETE FROM git_tokens WHERE id=?", [token.id]);
    });
  };
  try {
    const denied = await repo.service.serialized(scope, lease => repo.journal.publish(owner.user.id,
      [{ scope, before: raw(before.head), after, hydrate: false }], [lease], undefined, { tokenHash: credentialHash(token.secretOnce) }))
      .then(() => null, (error: unknown) => error);
    expect(denied).toMatchObject({ code: "GIT_AUTH_REQUIRED" });
  } finally { fixture.runtime.repositories.publish = publish; }
  expect(await fixture.runtime.db.get("SELECT head FROM branch_heads WHERE project_id=? AND branch=?", [project.id, "main"]))
    .toMatchObject({ head: before.head });
  const hidden = await fixture.runtime.repositories.read(project.id, ["rev-parse", "main"])
    .then(() => null, (error: unknown) => error);
  expect(hidden).toMatchObject({ code: "REPOSITORY_NOT_FINALIZED" });
});

test("T11 multi-branch hydration and named receipts roll back together and recover one publication", async () => {
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const scope = { projectId: project.id, branch: "main" };
  const alternate = { ...scope, branch: "atomic-alternate" };
  const repo = new GitRepository(fixture.service());
  const original = (await repo.service.readDocument(scope, project.settings.mainFileId)).text;
  const snapshots = await fixture.runtime.db.all("SELECT id FROM snapshots WHERE project_id=?", [project.id]);
  const heads: string[] = [];
  for (const marker of ["atomic-main", "atomic-alternate"]) {
    const blob = (await objects(repo.service, scope, ["hash-object", "-w", "--stdin"],
      new TextEncoder().encode(`${original}% ${marker}\n`))).text;
    const tree = (await objects(repo.service, scope, ["mktree"],
      new TextEncoder().encode(`100644 blob ${blob}\tmain.tex\n`))).text;
    heads.push(await repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: marker }));
  }
  const [main, other] = heads;
  if (!main || !other) throw new TypeError("Expected both actual commits");
  const receipt = { key: crypto.randomUUID(), digest: "atomic-batch", operation: OperationSchema.parse({
    id: crypto.randomUUID(), kind: "git-push", status: "succeeded", progress: 1,
    result: { head: `sha1:${main}` }, errorCode: null,
  }) };
  const record = fixture.runtime.events.record.bind(fixture.runtime.events);
  fixture.runtime.events.record = async (tx, event) => {
    if (event.topic === "git.changed") throw new Error("injected-hydration-finalization");
    return record(tx, event);
  };
  try {
    const failed = await repo.service.serialized(scope, lease => repo.service.serialized(alternate, otherLease =>
      repo.journal.publish(owner.user.id, [
        { scope, before: raw(before.head), after: main, hydrate: true },
        { scope: alternate, before: "0".repeat(40), after: other, hydrate: true },
      ], [lease, otherLease], receipt))).then(() => null, (error: unknown) => error);
    expect(failed).toMatchObject({ message: "injected-hydration-finalization" });
  } finally { fixture.runtime.events.record = record; }
  expect((await repo.service.readDocument(scope, project.settings.mainFileId)).text).toBe(original);
  expect(await fixture.runtime.db.get("SELECT id FROM branch_workspaces WHERE project_id=? AND branch=?",
    [project.id, alternate.branch])).toBeNull();
  expect(await fixture.runtime.db.all("SELECT id FROM snapshots WHERE project_id=?", [project.id])).toHaveLength(snapshots.length);
  expect(await fixture.runtime.db.all("SELECT key FROM core_git_receipts")).toHaveLength(0);
  expect(await fixture.runtime.db.all("SELECT id FROM repository_intents WHERE project_id=? AND state<>'finalized'", [project.id]))
    .toHaveLength(1);
  await fixture.restart();
  expect((await fixture.service().readDocument(scope, project.settings.mainFileId)).text).toBe(`${original}% atomic-main\n`);
  expect((await fixture.service().readDocument(alternate, project.settings.mainFileId)).text).toBe(`${original}% atomic-alternate\n`);
  expect(await fixture.runtime.db.all("SELECT id FROM snapshots WHERE project_id=?", [project.id])).toHaveLength(snapshots.length + 2);
  expect(await fixture.runtime.db.get("SELECT operation_json FROM core_git_receipts WHERE actor_id=? AND key=?",
    [owner.user.id, receipt.key])).toMatchObject({ operation_json: JSON.stringify(receipt.operation) });
  expect(await fixture.runtime.db.all("SELECT id FROM core_git_intents")).toHaveLength(0);
});
