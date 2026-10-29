import { expect, test } from "bun:test";
import { gitFixture, operationEnvelope } from "./harness";

test("T11 saved preference does not recompile committed receipts or permit Viewer commits", async () => {
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  await fixture.status(owner.headers, project.id);
  const service = fixture.service();
  const original = (await service.readDocument(scope, project.settings.mainFileId)).text;
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
    expectedRevision: (await service.getBranch(scope)).revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(`${original}% default commit\n`) })) }));
  const status = await fixture.status(owner.headers, project.id);
  const staged = await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
    body: JSON.stringify({ scope, head: status.head, hunkIds: status.hunks.map(hunk => hunk.id), staged: true, expectedVersion: status.revision }) });
  expect(staged.status, await staged.clone().text()).toBe(200);
  const key = crypto.randomUUID();
  const body = JSON.stringify({ scope, head: status.head, message: "Default no compile",
    compileFirst: false, expectedVersion: status.revision });
  const commit = () => fixture.request(`/api/projects/${project.id}/git/commit`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": key }, body,
  });
  const first = await commit();
  expect(first.status, await first.clone().text()).toBe(202);
  const receipt = operationEnvelope.parse(await first.json()).data;
  const preference = await fixture.request("/api/me/preferences", { method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ compileBeforeCommit: true, expectedVersion: 0 }) });
  expect(preference.status, await preference.clone().text()).toBe(200);
  // This fixture has no compiler: a replay must return its original receipt without accessing one.
  const replay = await commit();
  expect(replay.status).toBe(202);
  expect(operationEnvelope.parse(await replay.json()).data).toEqual(receipt);
  await fixture.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)",
    [crypto.randomUUID(), project.id, viewer.user.id, fixture.runtime.clock.now()]);
  const denied = await fixture.request(`/api/projects/${project.id}/git/commit`, {
    method: "POST", headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() }, body,
  });
  expect(denied.status).toBe(403);
  expect(await fixture.runtime.db.all("SELECT key FROM core_git_receipts")).toHaveLength(1);
  console.info("P61_REPLAY", JSON.stringify({ utc: new Date().toISOString(), origin: `http://${fixture.server.hostname}:${fixture.server.port}`,
    ownedRoot: fixture.path, firstStatus: first.status, replayStatus: replay.status, viewerStatus: denied.status, receipt }));
});
