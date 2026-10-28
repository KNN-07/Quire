import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { reviewFixture, mutation, sourceDoc, proposal } from "./harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

test("labeled history remains accessible to timeline download comparison and restore beyond the window", async () => {
  // Given: an actual labeled checkpoint under a one-day access policy.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const snapshot = await fixture.service.snapshot(owner.user.id, scope, 0);
  const label = await fixture.request(`/api/projects/${ids.project}/history/${snapshot.id}/labels`,
    mutation(owner.headers, { name: "Retained milestone", expectedVersion: 0 }));
  expect(label.status).toBe(200);
  await fixture.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
    VALUES(?,'project',?,?,?)`, [crypto.randomUUID(), ids.project,
    JSON.stringify({ ...defaultPolicy, historyDays: 1 }), fixture.runtime.clock.now()]);
  fixture.setTime("2026-10-28T12:00:00.000Z");
  // When: the same actor reads the retained milestone after the ordinary window.
  const timeline = await fixture.request(`/api/projects/${ids.project}/history?branch=main`, { headers: owner.headers });
  const entries = z.object({ data: endpoints.historyList.output }).parse(await timeline.json()).data.items;
  expect(entries.find(entry => entry.id === snapshot.id)?.accessible).toBe(true);
  const source = await fixture.request(`/api/projects/${ids.project}/history/${snapshot.id}/source.zip?branch=main`,
    { headers: owner.headers });
  const comparison = await fixture.request(
    `/api/projects/${ids.project}/history/compare?branch=main&from=${snapshot.id}&to=${snapshot.id}`, { headers: owner.headers });
  const restored = await fixture.request(`/api/projects/${ids.project}/history/${snapshot.id}/restore`,
    mutation(owner.headers, { scope, expectedVersion: 0 }));
  // Then: all consumers honor the same label-aware access boundary.
  expect(source.status).toBe(200);
  expect(comparison.status).toBe(200);
  expect(restored.status).toBe(200);
});

test("rechecks an expired restore target after repository publication under the account fence", async () => {
  // Given: a readable old target, a live owner, and a separately fresh operator.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const target = await fixture.service.snapshot(owner.user.id, scope, 0);
  const original = await fixture.service.readDocument(scope, ids.mainFile);
  fixture.setTime("2026-10-28T12:00:00.000Z");
  const operator = await fixture.login("operator@quire.local");
  const publish = fixture.runtime.repositories.publish.bind(fixture.runtime.repositories);
  const barrier = spyOn(fixture.runtime.repositories, "publish").mockImplementationOnce(async intent => {
    await publish(intent);
    const changed = await fixture.request("/api/admin/project-benefits/deployment/local", {
      method: "PUT", headers: operator.headers,
      body: JSON.stringify({ expectedVersion: 0,
        benefits: { compileSeconds: 12, writableMembers: null, historyDays: 1, trackChanges: false } }),
    });
    expect(changed.status).toBe(200);
  });
  try {
    // When: a downgrade commits between actual ref publication and SQL finalization.
    const restored = await fixture.request(`/api/projects/${ids.project}/history/${target.id}/restore`,
      mutation(owner.headers, { scope, expectedVersion: 0 }));
    // Then: the final account fence rejects the historical source without publishing its SQL state.
    expect(restored.status).toBe(403);
    expect(z.object({ error: z.object({ code: z.string() }) }).parse(await restored.json()).error.code).toBe("HISTORY_WINDOW");
    expect((await fixture.service.getBranch(scope)).revision).toBe(0);
    expect((await fixture.service.readDocument(scope, ids.mainFile)).text).toBe(original.text);
    expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toHaveLength(1);
  } finally { barrier.mockRestore(); }
});
test("completes a published restore replay without treating it as a new historical restoration", async () => {
  // Given: a completed restore with a durable source receipt and unchanged request identity.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const input = mutation(owner.headers, { scope, expectedVersion: 0 });
  const path = `/api/projects/${ids.project}/history/${ids.snapshot}/restore`;
  const initial = await fixture.request(path, input);
  expect(initial.status).toBe(200);
  const first = z.object({ data: endpoints.historyRestore.output }).parse(await initial.json()).data;
  fixture.setTime("2026-10-28T12:00:00.000Z");
  const operator = await fixture.login("operator@quire.local");
  expect((await fixture.request("/api/admin/project-benefits/deployment/local", {
    method: "PUT", headers: operator.headers,
    body: JSON.stringify({ expectedVersion: 0,
      benefits: { compileSeconds: 12, writableMembers: null, historyDays: 1, trackChanges: false } }),
  })).status).toBe(200);
  // When: the already-published restore is replayed after its old history target expires.
  const response = await fixture.request(path, input);
  // Then: completion returns retained metadata without a second source mutation or historical grant.
  expect(response.status).toBe(200);
  expect(z.object({ data: endpoints.historyRestore.output }).parse(await response.json()).data)
    .toMatchObject({ id: first.id, accessible: false });
  expect((await fixture.service.getBranch(scope)).revision).toBe(1);
});
test("refuses a completed restore replay after the acting collaborator's current access is revoked", async () => {
  // Given: an Editor's completed source restore and its exact durable request identity.
  await using fixture = await reviewFixture();
  const editor = await fixture.login("mai@quire.local");
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const input = mutation(editor.headers, { scope, expectedVersion: 0 });
  const path = `/api/projects/${ids.project}/history/${ids.snapshot}/restore`;
  expect((await fixture.request(path, input)).status).toBe(200);
  expect((await fixture.request(`/api/projects/${ids.project}/members/${ids.mai}`, {
    method: "DELETE", headers: owner.headers, body: JSON.stringify({ expectedVersion: 0 }),
  })).status).toBe(200);
  // When: the still-authenticated account replays the previously completed restoration.
  const response = await fixture.request(path, input);
  // Then: a durable receipt is not current project authority.
  expect(response.status).toBe(404);
  expect((await fixture.request("/api/me", { headers: editor.headers })).status).toBe(200);
  expect((await fixture.service.getBranch(scope)).revision).toBe(1);
});

test("retains old suggestions while tracking withdrawal rejects new Reviewer proposals", async () => {
  // Given: an existing real proposal and an owner grant that permits both seats.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const document = await fixture.service.loadDocument(scope, ids.mainFile);
  const doc = sourceDoc(document.state);
  try {
    const edit = proposal(doc, { fileId: ids.mainFile, before: "\\documentclass", after: "\\documentclass ",
      baseRevision: document.revision }, document.epoch);
    const created = await fixture.request(`/api/projects/${ids.project}/suggestions`,
      mutation(reviewer.headers, { scope, edits: [edit], expectedVersion: 0 }));
    expect(created.status).toBe(200);
    const saved = z.object({ data: endpoints.suggestionCreate.output }).parse(await created.json()).data;
    const operator = await fixture.login("operator@quire.local");
    // When: tracking is withdrawn without changing assigned or selected roles.
    expect((await fixture.request("/api/admin/project-benefits/deployment/local", {
      method: "PUT", headers: operator.headers,
      body: JSON.stringify({ expectedVersion: 0,
        benefits: { compileSeconds: 12, writableMembers: 2, historyDays: 1, trackChanges: false } }),
    })).status).toBe(200);
    const denied = await fixture.request(`/api/projects/${ids.project}/suggestions`,
      mutation(reviewer.headers, { scope, edits: [edit], expectedVersion: 0 }));
    const decision = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`,
      mutation(owner.headers, { ids: [saved.id], decision: "reject", expectedVersion: 0 }));
    // Then: a current Editor/Owner can decide retained work, but no new tracking begins.
    expect(denied.status).toBe(403);
    expect(decision.status).toBe(200);
    expect(z.object({ data: endpoints.suggestionDecide.output }).parse(await decision.json()).data[0])
      .toMatchObject({ id: saved.id, authorId: reviewer.user.id, edits: [{ before: edit.before, after: edit.after, status: "rejected" }] });
  } finally { doc.destroy(); }
});
test("permits comments from an explicitly selected Reviewer while tracking is disabled", async () => {
  // Given: an overfull project, tracking disabled, and the owner's explicit Reviewer selection.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const operator = await fixture.login("operator@quire.local");
  expect((await fixture.request("/api/admin/project-benefits/deployment/local", {
    method: "PUT", headers: operator.headers, body: JSON.stringify({ expectedVersion: 0,
      benefits: { compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false } }),
  })).status).toBe(200);
  const member = z.object({ id: z.string() }).parse(await fixture.runtime.db.get(
    "SELECT id FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.sam]));
  expect((await fixture.request(`/api/projects/${ids.project}/writable-members`, { method: "PUT", headers: owner.headers,
    body: JSON.stringify({ memberIds: [member.id], expectedVersion: 0 }) })).status).toBe(200);
  // When: the selected Reviewer posts an ordinary comment through the real thread endpoint.
  const response = await fixture.request(`/api/projects/${ids.project}/threads`,
    mutation(reviewer.headers, { scope: { projectId: ids.project, branch: "main" }, body: "Comment-only review", expectedVersion: 0 }));
  // Then: commenting remains distinct from tracking new proposals.
  expect(response.status).toBe(200);
  const thread = z.object({ data: endpoints.threadCreate.output }).parse(await response.json()).data;
  expect(thread.comments).toHaveLength(1);
  expect(thread.comments[0]?.authorId).toBe(reviewer.user.id);
});
