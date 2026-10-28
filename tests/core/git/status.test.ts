import { expect, test } from "bun:test";
import { gitFixture } from "./harness";

test("status reads preserve project versions and immutable history after initialization", async () => {
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  await fixture.status(owner.headers, project.id);
  const before = await fixture.service().getProject(project.id);
  const snapshots = await fixture.runtime.db.all("SELECT * FROM snapshots WHERE project_id=? ORDER BY id", [project.id]);
  const events = await fixture.runtime.db.all("SELECT * FROM events WHERE aggregate_id=? ORDER BY seq", [project.id]);
  const first = await fixture.status(owner.headers, project.id);
  const second = await fixture.status(owner.headers, project.id);
  expect(second).toEqual(first);
  expect(await fixture.service().getProject(project.id)).toEqual(before);
  expect(await fixture.runtime.db.all("SELECT * FROM snapshots WHERE project_id=? ORDER BY id", [project.id])).toEqual(snapshots);
  expect(await fixture.runtime.db.all("SELECT * FROM events WHERE aggregate_id=? ORDER BY seq", [project.id])).toEqual(events);
});

test("T11 reports real topic ahead and behind counts against the default branch", async () => {
  // Given: a topic branch created from the initialized default branch.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const mainScope = { projectId: project.id, branch: "main" };
  const initial = await fixture.status(owner.headers, project.id);
  const created = await fixture.request(`/api/projects/${project.id}/git/branches`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ name: "topic", from: "main", expectedVersion: initial.revision }),
  });
  expect(created.status).toBe(200);
  const service = fixture.service();
  const topicScope = { ...mainScope, branch: "topic" };
  const topicText = (await service.readDocument(topicScope, project.settings.mainFileId)).text + "% topic\n";
  await service.serialized(topicScope, async lease => service.commitSource({
    lease, actorId: owner.user.id, scope: topicScope,
    expectedRevision: (await service.getBranch(topicScope)).revision,
    inputs: (await service.listFiles(topicScope)).map(file => ({
      file, bytes: new TextEncoder().encode(topicText),
    })),
  }));
  const dirtyTopic = await fixture.status(owner.headers, project.id, "topic");
  const stage = await fixture.request(`/api/projects/${project.id}/git/stage`, {
    method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${dirtyTopic.revision}"` },
    body: JSON.stringify({
      scope: topicScope, head: dirtyTopic.head, hunkIds: dirtyTopic.hunks.map(hunk => hunk.id),
      staged: true, expectedVersion: dirtyTopic.revision,
    }),
  });
  expect(stage.status).toBe(200);
  const topicCommit = await fixture.request(`/api/projects/${project.id}/git/commit`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      scope: topicScope, head: dirtyTopic.head, message: "Topic",
      compileFirst: false, expectedVersion: dirtyTopic.revision,
    }),
  });
  expect(topicCommit.status).toBe(202);
  // When: main independently advances after topic's commit.
  const mainText = (await service.readDocument(mainScope, project.settings.mainFileId)).text + "% main\n";
  await service.serialized(mainScope, async lease => service.commitSource({
    lease, actorId: owner.user.id, scope: mainScope,
    expectedRevision: (await service.getBranch(mainScope)).revision,
    inputs: (await service.listFiles(mainScope)).map(file => ({
      file, bytes: new TextEncoder().encode(mainText),
    })),
  }));
  const dirtyMain = await fixture.status(owner.headers, project.id);
  await fixture.request(`/api/projects/${project.id}/git/stage`, {
    method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${dirtyMain.revision}"` },
    body: JSON.stringify({
      scope: mainScope, head: dirtyMain.head, hunkIds: dirtyMain.hunks.map(hunk => hunk.id),
      staged: true, expectedVersion: dirtyMain.revision,
    }),
  });
  await fixture.request(`/api/projects/${project.id}/git/commit`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      scope: mainScope, head: dirtyMain.head, message: "Main",
      compileFirst: false, expectedVersion: dirtyMain.revision,
    }),
  });
  // Then: counts come from actual diverged ancestry, not design constants.
  const status = await fixture.status(owner.headers, project.id, "topic");
  expect(status.upstream).toBe("main");
  expect(status.ahead).toBe(1);
  expect(status.behind).toBe(1);
  expect(status.base).not.toBe(status.head);
});
