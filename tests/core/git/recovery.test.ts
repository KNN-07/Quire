import { test, expect } from "bun:test";
import { OperationSchema } from "@quire/contracts";
import { z } from "zod";
import { GitRepository } from "../../../services/core/git";
import { raw, run } from "../../../services/core/git/process";
import { gitFixture, operationEnvelope } from "./harness";

test("T11 replays prepared named-ref intent and hydrates source after restart", async () => {
  // Given: a durable prepared intent whose new commit has not yet reached the named ref.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const scope = { projectId: project.id, branch: "main" };
  const repo = new GitRepository(fixture.service());
  const blob = (await run({ path: repo.path(scope), args: ["hash-object", "-w", "--stdin"],
    input: new TextEncoder().encode("\\documentclass{article}\n% recovered\n") })).text;
  const tree = (await run({ path: repo.path(scope), args: ["mktree"],
    input: new TextEncoder().encode(`100644 blob ${blob}\tmain.tex\n`) })).text;
  const after = await repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: "Recovered commit" });
  const id = crypto.randomUUID();
  await fixture.runtime.db.run("INSERT INTO core_git_intents(id,payload_json,created_at) VALUES(?,?,?)",
    [id, JSON.stringify({ id, actorId: owner.user.id,
      changes: [{ scope, before: raw(before.head), after, hydrate: true }] }), "2026-10-26T12:00:00.000Z"]);
  // When: normal module registration recovers the interrupted publication.
  await fixture.restart();
  // Then: named Git and durable browser source both reflect the commit exactly once.
  expect((await fixture.status(owner.headers, project.id)).head).toBe(`sha1:${after}`);
  expect((await fixture.service().readDocument(scope, project.settings.mainFileId)).text).toBe("\\documentclass{article}\n% recovered\n");
  expect(await fixture.runtime.db.all("SELECT * FROM core_git_intents")).toHaveLength(0);
  expect((await fixture.service().getBranch(scope)).revision).toBe(before.revision + 1);
});

test("T11 recovers an already-published ref with its durable operation replay receipt", async () => {
  // Given: a commit whose ref was published immediately before the process stopped.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const scope = { projectId: project.id, branch: "main" };
  const repo = new GitRepository(fixture.service());
  const tree = (await run({ path: repo.path(scope), args: ["rev-parse", "main^{tree}"] })).text;
  const after = await repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: "Crash receipt" });
  const key = crypto.randomUUID();
  const body = { scope, head: before.head, message: "Crash receipt", compileFirst: false, expectedVersion: before.revision };
  const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify({ ...body, key })).digest("hex");
  const id = crypto.randomUUID();
  const operation = OperationSchema.parse({ id: crypto.randomUUID(), kind: "git-commit", status: "succeeded", progress: 1, result: { head: `sha1:${after}` }, errorCode: null });
  await fixture.runtime.db.run("INSERT INTO core_git_intents(id,payload_json,created_at) VALUES(?,?,?)",
    [id, JSON.stringify({ id, actorId: owner.user.id, changes: [{ scope, before: raw(before.head), after, hydrate: false }],
      receipt: { key, digest, operation } }), "2026-10-26T12:00:00.000Z"]);
  await run({ path: repo.path(scope), args: ["update-ref", "refs/heads/main", after, raw(before.head)] });
  // When: registration recovers finalization and the browser retries the original request.
  await fixture.restart();
  const response = await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": key }, body: JSON.stringify(body) });
  // Then: the same durable operation is returned without a second commit.
  expect(response.status).toBe(202);
  expect(operationEnvelope.parse(await response.json()).data.id).toBe(operation.id);
  expect((await run({ path: repo.path(scope), args: ["rev-list", "--count", "main"] })).text).toBe("2");
});

test("T11 marks a mismatched ref intent conflicted and blocks later named mutations", async () => {
  // Given: a real initialized branch whose ref no longer matches a proposed CAS.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const before = await fixture.status(owner.headers, project.id);
  const scope = { projectId: project.id, branch: "main" };
  const repo = new GitRepository(fixture.service());
  const tree = (await run({ path: repo.path(scope), args: ["rev-parse", "main^{tree}"] })).text;
  const after = await repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: "CAS rejected" });
  // When: the stale intent attempts publication, followed by another named mutation.
  const rejected = await repo.service.serialized(scope, lease => repo.journal.publish(owner.user.id, [{ scope, before: "0".repeat(40), after, hydrate: false }], [lease]))
    .then(() => null, (error: unknown) => error);
  expect(rejected).toMatchObject({ code: "REF_CONFLICT" });
  const blocked = await repo.service.serialized(scope, lease => repo.journal.publish(owner.user.id, [{ scope, before: raw(before.head), after, hydrate: false }], [lease]))
    .then(() => null, (error: unknown) => error);
  // Then: durable conflict state preserves the old ref and fences later mutations.
  expect(blocked).toMatchObject({ code: "GIT_RECOVERY_PENDING" });
  expect(z.object({ state: z.string() }).parse(await fixture.runtime.db.get("SELECT state FROM core_git_intents")).state).toBe("conflicted");
  expect((await run({ path: repo.path(scope), args: ["rev-parse", "main"] })).text).toBe(raw(before.head));
});
