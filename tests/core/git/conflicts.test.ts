import { test, expect } from "bun:test";
import { z } from "zod";
import { gitFixture } from "./harness";
import { GitRepository } from "../../../services/core/git";
import { run, raw } from "../../../services/core/git/process";

test("T11 rejects a real content-conflicting merge without moving refs or browser source", async () => {
  // Given: two actual Git commits changing the same source line from a common parent.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const before = await fixture.status(owner.headers, project.id);
  const repo = new GitRepository(fixture.service());
  const source = fixture.service().readDocument(scope, project.settings.mainFileId).text;
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
  await repo.service.serialized(scope, () => repo.journal.publish(owner.user.id, [
    { scope, before: raw(before.head), after: left, hydrate: true },
    { scope: { ...scope, branch: "other" }, before: "0".repeat(40), after: right, hydrate: true },
  ]));
  const status = await fixture.status(owner.headers, project.id);
  const live = fixture.service().readDocument(scope, project.settings.mainFileId).text;
  // When: the browser requests the real conflicting merge.
  const response = await fixture.request(`/api/projects/${project.id}/git/merge`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, head: status.head, from: "other", expectedVersion: status.revision }) });
  // Then: the conflict is explicit and neither named source nor browser edits change.
  expect(response.status).toBe(409);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("MERGE_CONFLICT");
  expect((await fixture.status(owner.headers, project.id)).head).toBe(status.head);
  expect(fixture.service().readDocument(scope, project.settings.mainFileId).text).toBe(live);
});
