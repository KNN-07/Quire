import { test, expect } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { gitFixture } from "./harness";
import { GitRepository } from "../../../services/core/git";
import { run, raw } from "../../../services/core/git/process";

test("T11 returns structured conflicts and resolves them behind both head fences", async () => {
  // Given: two actual Git commits changing the same source line from a common parent.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const before = await fixture.status(owner.headers, project.id);
  const repo = new GitRepository(fixture.service());
  const source = (await fixture.service().readDocument(scope, project.settings.mainFileId)).text;
  const heads: string[] = [];
  for (const text of ["left", "right"]) {
    const blob = (await run({ path: repo.path(scope), args: ["hash-object", "-w", "--stdin"],
      input: new TextEncoder().encode(source.replace("\\begin{document}", `\\begin{document}\n${text}`)) })).text;
    const tree = (await run({ path: repo.path(scope), args: ["mktree"],
      input: new TextEncoder().encode(`100644 blob ${blob}\tmain.tex\n`) })).text;
    heads.push(await repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: text }));
  }
  const [left, right] = heads;
  if (!left || !right) throw new TypeError("Expected two commits");
  await repo.service.serialized(scope, lease => repo.service.serialized({ ...scope, branch: "other" }, other => repo.journal.publish(owner.user.id, [
    { scope, before: raw(before.head), after: left, hydrate: true },
    { scope: { ...scope, branch: "other" }, before: "0".repeat(40), after: right, hydrate: true },
  ], [lease, other])));
  const status = await fixture.status(owner.headers, project.id);
  const live = (await fixture.service().readDocument(scope, project.settings.mainFileId)).text;
  // When: the browser requests the real conflicting merge and submits an explicit resolution.
  const response = await fixture.request(`/api/projects/${project.id}/git/merge`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, head: status.head, from: "other", expectedVersion: status.revision }) });
  expect(response.status).toBe(202);
  const result = resultSchema(endpoints.gitMerge.output).parse(await response.json());
  if ("error" in result || result.data.kind !== "conflict") throw new TypeError("Expected structured merge conflict");
  const conflict = result.data.conflict;
  expect(conflict.files.map(file => file.path)).toContain("main.tex");
  expect(conflict.files[0]?.ours).toContain("left");
  expect(conflict.files[0]?.theirs).toContain("right");
  // Then: merely opening the conflict moves nothing.
  expect((await fixture.status(owner.headers, project.id)).head).toBe(status.head);
  expect((await fixture.service().readDocument(scope, project.settings.mainFileId)).text).toBe(live);
  const resolvedText = source.replace("\\begin{document}", "\\begin{document}\nresolved");
  const resolved = await fixture.request(
    `/api/projects/${project.id}/git/conflicts/${conflict.id}/resolve`,
    {
      method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        scope, from: conflict.from, head: conflict.head, fromHead: conflict.fromHead,
        expectedVersion: conflict.version,
        resolutions: conflict.files.map(file => ({
          path: file.path, choice: "text", text: file.path === "main.tex" ? resolvedText : file.merged ?? "",
        })),
      }),
    },
  );
  expect(resolved.status, await resolved.clone().text()).toBe(202);
  expect((await fixture.service().readDocument(scope, project.settings.mainFileId)).text).toBe(resolvedText);
  const parents = (await run({ path: repo.path(scope), args: ["rev-list", "--parents", "-1", "main"] })).text.split(" ");
  expect(parents).toHaveLength(3);
});

test("T11 rejects a resolution after either merge head moves", async () => {
  // Given: a deterministic real conflict.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const before = await fixture.status(owner.headers, project.id);
  const repo = new GitRepository(fixture.service());
  const source = (await fixture.service().readDocument(scope, project.settings.mainFileId)).text;
  const commits = await Promise.all(["left", "right"].map(async marker => {
    const blob = (await run({ path: repo.path(scope), args: ["hash-object", "-w", "--stdin"],
      input: new TextEncoder().encode(source.replace("\\begin{document}", `\\begin{document}\n${marker}`)) })).text;
    const tree = (await run({ path: repo.path(scope), args: ["mktree"],
      input: new TextEncoder().encode(`100644 blob ${blob}\tmain.tex\n`) })).text;
    return repo.commitTree(owner.user.id, { scope, tree, parents: [raw(before.head)], message: marker });
  }));
  const left = commits[0], right = commits[1];
  if (!left || !right) throw new TypeError("Expected conflicting commits");
  await repo.service.serialized(scope, lease => repo.service.serialized({ ...scope, branch: "other" }, other => repo.journal.publish(owner.user.id, [
    { scope, before: raw(before.head), after: left, hydrate: true },
    { scope: { ...scope, branch: "other" }, before: "0".repeat(40), after: right, hydrate: true },
  ], [lease, other])));
  const status = await fixture.status(owner.headers, project.id);
  const opened = await fixture.request(`/api/projects/${project.id}/git/merge`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, head: status.head, from: "other", expectedVersion: status.revision }),
  });
  const envelope = resultSchema(endpoints.gitMerge.output).parse(await opened.json());
  if ("error" in envelope || envelope.data.kind !== "conflict") throw new TypeError("Expected conflict");
  const conflict = envelope.data.conflict;
  await fixture.runtime.db.run("UPDATE branch_workspaces SET revision=revision+1 WHERE project_id=? AND branch=?",
    [project.id, "main"]);
  // When: resolution uses the captured version after the branch revision changed.
  const stale = await fixture.request(`/api/projects/${project.id}/git/conflicts/${conflict.id}/resolve`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      scope, from: conflict.from, head: conflict.head, fromHead: conflict.fromHead,
      expectedVersion: conflict.version,
      resolutions: conflict.files.map(file => ({ path: file.path, choice: "ours" })),
    }),
  });
  // Then: the stale resolution is fenced and named history stays put.
  expect(stale.status).toBe(409);
  expect((await fixture.status(owner.headers, project.id)).head).toBe(status.head);
});
