import { expect, test } from "bun:test";
import { aiFixture, errorSchema, runSchema } from "./harness";
import { providerServer } from "./provider";
import { defaultPolicy } from "../../../services/accounts/identity/policy";

test("accepts and undoes a reviewed patch through the real HTTP routes", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Insert", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% HTTP\n",
  })) }));
  const generated = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Insert", fileIds: [original.file.id] });
  const acceptedResponse = await fixture.request(`/api/ai/runs/${generated.id}/decide`, { method: "POST",
    headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: generated.version, editIds: [], decision: "accept" }) });
  const accepted = runSchema.parse(await acceptedResponse.json()).data;
  expect(accepted.proposals[0]?.edits[0]?.status).toBe("accepted");
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(`% HTTP\n${original.text}`);
  // When
  const response = await fixture.request(`/api/ai/runs/${generated.id}/undo`, { method: "POST",
    headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: accepted.version, editIds: [] }) });
  // Then
  expect(runSchema.parse(await response.json()).data.version).toBe(accepted.version + 1);
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(1);
});

test("cancels a running HTTP request without refunding dispatched usage", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const gate = provider.gate(); const terminal = fixture.settled();
  const created = await fixture.ai.create(session.actor, { key: crypto.randomUUID(), request: {
    scope: { projectId: project.id, branch: project.defaultBranch }, mode: "ask", tool: "chat", prompt: "Wait", fileIds: [],
  } });
  await gate.entered;
  const current = await fixture.ai.get(session.actor, created.id);
  // When
  const response = await fixture.request(`/api/ai/runs/${created.id}/cancel`, { method: "POST", headers: session.headers,
    body: JSON.stringify({ expectedVersion: current.run.version }) });
  gate.release(); await terminal;
  // Then
  expect(response.status).toBe(200);
  expect((await fixture.ai.get(session.actor, created.id)).run.status).toBe("canceled");
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(1);
});

test("denies acceptance to a reviewer even when AI policy permits Agent runs", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login(); const reviewer = await fixture.login("sam@quire.local");
  await fixture.configure(); const project = await fixture.project(owner);
  await fixture.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'reviewer',?)",
    [crypto.randomUUID(), project.id, reviewer.user.id, fixture.clock.now()]);
  await fixture.runtime.db.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'2026-10-27',1,?)", [reviewer.user.id, fixture.clock.now()]);
  await fixture.runtime.db.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
    [JSON.stringify({ ...defaultPolicy, ai: "agent" }), reviewer.user.id]);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  provider.respond(context => ({ text: "Insert", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% no\n",
  })) }));
  const run = await fixture.run(owner, { scope, mode: "agent", tool: "chat", prompt: "Insert", fileIds: [project.settings.mainFileId] });
  // When
  const response = await fixture.request(`/api/ai/runs/${run.id}/decide`, { method: "POST",
    headers: { ...reviewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: run.version, editIds: [], decision: "accept" }) });
  // Then
  expect(response.status).toBe(403);
  expect(errorSchema.parse(await response.json()).error.code).toBe("FORBIDDEN");
  expect((await fixture.ai.get(owner.actor, run.id)).run.proposals[0]?.edits[0]?.status).toBe("pending");
});
