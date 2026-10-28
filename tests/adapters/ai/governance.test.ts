import { expect, test } from "bun:test";
import { aiFixture, errorSchema, runSchema } from "./harness";
import { providerServer } from "./provider";

test("rejects unconfigured calls before disclosing context", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); const project = await fixture.project(session);
  const body = { scope: { projectId: project.id, branch: project.defaultBranch }, mode: "ask", tool: "chat", prompt: "Secret", fileIds: [] };
  // When
  const response = await fixture.request(`/api/projects/${project.id}/ai/runs`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
  // Then
  expect(errorSchema.parse(await response.json()).error.code).toBe("AI_UNCONFIGURED");
  expect(provider.received).toHaveLength(0);
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(0);
});

test("atomically shares allowance across tools and resets at UTC midnight", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(1); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const gate = provider.gate();
  const finished = fixture.settled();
  const send = (tool: string) => fixture.request(`/api/projects/${project.id}/ai/runs`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, mode: "ask", tool, prompt: "Hello", fileIds: [] }) });
  // When
  const responses = await Promise.all([send("chat"), send("table-prompt"), send("equation-prompt")]);
  await gate.entered; gate.release(); await finished;
  // Then
  expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([202, 429, 429]);
  expect(provider.received).toHaveLength(1);
  fixture.clock.advance(12 * 3600_000);
  const reset = await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "Next day", fileIds: [] });
  expect(reset.status).toBe("succeeded");
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(2);
});

test("cancels dispatched work and discards output when confidential policy changes", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const gate = provider.gate(); const finished = fixture.settled();
  const response = await fixture.request(`/api/projects/${project.id}/ai/runs`, { method: "POST",
    headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, mode: "agent", tool: "chat", prompt: "Sensitive", fileIds: [project.settings.mainFileId] }) });
  const run = runSchema.parse(await response.json()).data;
  await gate.entered;
  // When
  await fixture.ai.store.setSecurity(session.actor, { scope, confidential: true, expectedVersion: 0 });
  gate.release(); await finished;
  // Then
  const latest = await fixture.ai.get(session.actor, run.id);
  expect(latest.run.status).toBe("canceled");
  expect(latest.run.proposals).toHaveLength(0);
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(1);
});

test("keeps private chat session-local and absent from persisted request text", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const other = await fixture.login();
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const run = await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "private-canary-xyz", fileIds: [] });
  // When
  const denied = await fixture.request(`/api/ai/runs/${run.id}`, { headers: other.headers });
  // Then
  expect(denied.status).toBe(404);
  const metadata = await fixture.runtime.db.get<{ request_json: string }>("SELECT request_json FROM ai_run_metadata WHERE run_id=?", [run.id]);
  expect(metadata?.request_json).not.toContain("private-canary-xyz");
  await fixture.run(other, { scope, mode: "ask", tool: "chat", prompt: "Separate session", fileIds: [] });
  expect(JSON.stringify(provider.received.at(-1))).not.toContain("private-canary-xyz");
});
