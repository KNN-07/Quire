import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { endpoints, ProposedEditSchema } from "@quire/contracts";
import { reviewFixture, proposal, sourceDoc, mutation } from "../harness";
import { fixtureIds as ids, defaultPolicy } from "../../../fixtures/foundation";

const scope = { projectId: ids.project, branch: "main" };
type Fixture = Awaited<ReturnType<typeof reviewFixture>>;
async function edit(fixture: Fixture, actorId: typeof ids.kien, before: string, after: string) {
  const current = await fixture.service.loadDocument(scope, ids.mainFile);
  const doc = sourceDoc(current.state);
  try {
    const change = ProposedEditSchema.parse({
      ...proposal(doc, { fileId: ids.mainFile, before, after, baseRevision: current.revision }, current.epoch),
      id: crypto.randomUUID(), status: "pending",
    });
    await fixture.service.applyEdits(actorId, scope, [change], crypto.randomUUID());
  } finally { doc.destroy(); }
}
const changesUrl = (from: string, to: string, fileId = "") =>
  `/api/projects/${ids.project}/history/changes?branch=main&from=${from}&to=${to}${fileId ? `&fileId=${fileId}` : ""}`;
const output = z.object({ data: endpoints.historyChanges.output });

test("returns two recorded actors and exact consecutive changes without attributing unchanged checkpoints", async () => {
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const editor = await fixture.login("mai@quire.local");
  const viewer = await fixture.login("alex@quire.local");
  const from = await fixture.service.snapshot(owner.user.id, scope, 0);
  await edit(fixture, owner.user.id, "article", "report");
  await edit(fixture, editor.user.id, "report", "book");
  const to = await fixture.service.snapshot(owner.user.id, scope, 2);
  const response = await fixture.request(changesUrl(from.id, to.id), { headers: viewer.headers });
  expect(response.status).toBe(200);
  const result = output.parse(await response.json()).data;
  expect(result.changes).toHaveLength(2);
  expect(result.changes.map(change => change.actorId)).toEqual([owner.user.id, editor.user.id]);
  expect(result.changes.map(change => [change.fromRevision, change.toRevision])).toEqual([[0, 1], [1, 2]]);
  expect(result.changes[0]?.after).toBe(result.changes[1]?.before);
  expect(result.changes[0]?.fromVersionId).toBe(from.id);
  expect(result.changes.every(change => change.granularity === "recorded-file-transition")).toBe(true);
  expect(result.participants).toEqual([
    { id: owner.user.id, displayName: owner.user.name }, { id: editor.user.id, displayName: editor.user.name },
  ]);
  const raw = JSON.stringify(result);
  expect(raw).not.toContain("@");
  expect(raw).not.toContain("members");
  expect(raw).not.toContain(viewer.user.id);
  const again = output.parse(await (await fixture.request(changesUrl(from.id, to.id), { headers: owner.headers })).json()).data;
  expect(again).toEqual(result);
  const filtered = output.parse(await (await fixture.request(changesUrl(from.id, to.id, ids.snapshot), { headers: owner.headers })).json()).data;
  expect(filtered.changes).toEqual([]);
  expect(filtered.participants).toEqual([]);
  expect((await fixture.request(changesUrl(to.id, from.id), { headers: owner.headers })).status).toBe(422);
  const legacy = await fixture.request(changesUrl(from.id, to.id).replace("/changes?", "/compare?"), { headers: viewer.headers });
  expect(z.object({ data: endpoints.historyCompare.output }).parse(await legacy.json()).data.authors)
    .toContain(editor.user.id);
});

test("refuses inaccessible intermediate history between retained endpoints and rechecks before publishing", async () => {
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const from = await fixture.service.snapshot(owner.user.id, scope, 0);
  await edit(fixture, owner.user.id, "article", "report");
  await edit(fixture, ids.mai, "report", "book");
  const to = await fixture.service.snapshot(owner.user.id, scope, 2);
  for (const version of [from, to]) {
    expect((await fixture.request(`/api/projects/${ids.project}/history/${version.id}/labels`,
      mutation(owner.headers, { name: "Retained endpoint", expectedVersion: 0 }))).status).toBe(200);
  }
  fixture.setTime("2026-10-28T12:00:00.000Z");
  const restrict = async () => {
    await fixture.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
      VALUES(?,'project',?,?,?)`, [crypto.randomUUID(), ids.project,
      JSON.stringify({ ...defaultPolicy, historyDays: 1 }), fixture.runtime.clock.now()]);
  };
  const get = fixture.runtime.blobs.get.bind(fixture.runtime.blobs);
  const barrier = spyOn(fixture.runtime.blobs, "get").mockImplementationOnce(async digest => {
    const bytes = await get(digest);
    await restrict();
    return bytes;
  });
  try {
    const raced = await fixture.request(changesUrl(from.id, to.id), { headers: owner.headers });
    expect(raced.status).toBe(403);
    expect(await raced.text()).not.toContain("\\documentclass");
  } finally { barrier.mockRestore(); }
  const denied = await fixture.request(changesUrl(from.id, to.id), { headers: owner.headers });
  expect(denied.status).toBe(403);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await denied.json()).error.code).toBe("HISTORY_WINDOW");
  expect((await fixture.request(changesUrl(from.id, from.id), { headers: owner.headers })).status).toBe(200);
});

test("scopes identities and changes to current project access and reports deleted account names as unknown", async () => {
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const editor = await fixture.login("mai@quire.local");
  const from = await fixture.service.snapshot(owner.user.id, scope, 0);
  await edit(fixture, editor.user.id, "article", "report");
  const to = await fixture.service.snapshot(owner.user.id, scope, 1);
  expect((await fixture.request(changesUrl(from.id, to.id).replace("branch=main", "branch=other"),
    { headers: owner.headers })).status).toBe(404);
  const foreign = await fixture.create(owner.headers);
  expect((await fixture.request(changesUrl(from.id, to.id).replace(ids.project, foreign.id),
    { headers: owner.headers })).status).toBe(404);
  await fixture.runtime.db.run("UPDATE users SET deleted_at=? WHERE id=?", [fixture.runtime.clock.now(), editor.user.id]);
  const result = output.parse(await (await fixture.request(changesUrl(from.id, to.id), { headers: owner.headers })).json()).data;
  expect(result.participants).toEqual([{ id: editor.user.id, displayName: null }]);
  expect(result.changes[0]?.actorId).toBe(editor.user.id);
  expect((await fixture.request(changesUrl(from.id, to.id), { headers: editor.headers })).status).not.toBe(200);
});

test("records the accepting actor separately from the persisted proposal author", async () => {
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const from = await fixture.service.snapshot(owner.user.id, scope, 0);
  const doc = sourceDoc((await fixture.service.loadDocument(scope, ids.mainFile)).state);
  try {
    const created = await fixture.request(`/api/projects/${ids.project}/suggestions`, mutation(reviewer.headers, {
      scope, edits: [proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 })],
      expectedVersion: 0,
    }));
    const suggestion = z.object({ data: endpoints.suggestionCreate.output }).parse(await created.json()).data;
    const decision = { ids: [suggestion.id], decision: "accept", expectedVersion: 0 };
    expect((await fixture.request(`/api/projects/${ids.project}/suggestions/decide`, mutation(reviewer.headers, decision))).status).toBe(403);
    const accepted = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`, mutation(owner.headers, decision));
    expect(z.object({ data: endpoints.suggestionDecide.output }).parse(await accepted.json()).data[0]?.authorId).toBe(reviewer.user.id);
    const to = await fixture.service.snapshot(owner.user.id, scope, 1);
    const result = output.parse(await (await fixture.request(changesUrl(from.id, to.id), { headers: reviewer.headers })).json()).data;
    expect(result.changes.map(change => change.actorId)).toEqual([owner.user.id]);
    expect(result.participants).toEqual([{ id: owner.user.id, displayName: owner.user.name }]);
  } finally { doc.destroy(); }
});
