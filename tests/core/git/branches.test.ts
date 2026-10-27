import { test, expect } from "bun:test";
import { z } from "zod";
import { gitFixture, statusEnvelope } from "./harness";
import { run, raw } from "../../../services/core/git/process";
import { GitRepository } from "../../../services/core/git";

test("T11 creates a real branch merges its two-parent history and deletes the branch", async () => {
  // Given: an initialized real repository and browser workspace.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const initial = await fixture.status(owner.headers, project.id);
  const scope = { projectId: project.id, branch: "main" };
  const created = await fixture.request(`/api/projects/${project.id}/git/branches`, { method: "POST", headers: owner.headers,
    body: JSON.stringify({ name: "topic", from: "main", expectedVersion: initial.revision }) });
  const topic = statusEnvelope.parse(await created.json()).data;
  const service = fixture.service();
  const repo = new GitRepository(service);
  const changed = service.readDocument({ ...scope, branch: "topic" }, project.settings.mainFileId).text + "% topic\n";
  await service.serialized({ ...scope, branch: "topic" }, () => service.commitSource({
    actorId: owner.user.id, scope: { ...scope, branch: "topic" }, expectedRevision: service.getBranch({ ...scope, branch: "topic" }).revision,
    inputs: service.listFiles({ ...scope, branch: "topic" }).map(file => ({ file, bytes: new TextEncoder().encode(changed) })),
  }));
  const topicStatus = await fixture.status(owner.headers, project.id, "topic");
  await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${topicStatus.revision}"` },
    body: JSON.stringify({ scope: { ...scope, branch: "topic" }, head: topic.head, hunkIds: topicStatus.hunks.map(h => h.id), staged: true, expectedVersion: topicStatus.revision }) });
  await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope: { ...scope, branch: "topic" }, head: topic.head, message: "Topic", compileFirst: false, expectedVersion: topicStatus.revision }) });
  // When: the topic is merged into clean main and then removed.
  const merged = await fixture.request(`/api/projects/${project.id}/git/merge`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, head: initial.head, from: "topic", expectedVersion: initial.revision }) });
  const removed = await fixture.request(`/api/projects/${project.id}/git/branches/topic`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ scope: { ...scope, branch: "topic" }, expectedVersion: topicStatus.revision }) });
  // Then: browser source and actual two-parent Git history agree.
  expect(merged.status).toBe(202);
  expect(removed.status).toBe(200);
  const parents = (await run({ path: repo.path(scope), args: ["rev-list", "--parents", "-1", "main"] })).text.split(" ");
  expect(parents).toHaveLength(3);
  expect(parents[1]).toBe(raw(initial.head));
  expect(service.readDocument(scope, project.settings.mainFileId).text).toBe(changed);
  const log = await fixture.request(`/api/projects/${project.id}/git/log?branch=main`, { headers: owner.headers });
  expect(z.object({ data: z.object({ items: z.array(z.object({ message: z.string() })) }) }).parse(await log.json()).data.items[0]?.message).toBe("Merge topic");
});
