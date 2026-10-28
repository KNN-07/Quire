import { expect, test } from "bun:test";
import { aiFixture } from "./harness";
import { providerServer } from "./provider";

test("preserves migration digests and replays an Agent receipt without redispatch after restart", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const request = { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "agent" as const, tool: "chat" as const, prompt: "Audited", fileIds: [] };
  const key = crypto.randomUUID(); const finished = fixture.settled();
  const run = await fixture.ai.create(session.actor, { request, key });
  await finished;
  const migrations = await fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
  // When
  await fixture.restart();
  const replay = await fixture.ai.create(session.actor, { request, key });
  // Then
  expect(replay.id).toBe(run.id);
  expect(replay.status).toBe("succeeded");
  expect(replay.messages[0]?.text).toBe("Audited");
  expect(provider.received).toHaveLength(1);
  expect(await fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")).toEqual(migrations);
});

test("shares a daily reservation across independent native runtime instances", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(1); const project = await fixture.project(session);
  await using second = await fixture.fork();
  const request = { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask" as const, tool: "chat" as const, prompt: "Race", fileIds: [] };
  const gate = provider.gate();
  // When
  const outcomes = await Promise.allSettled([fixture.ai, second.service].map(service =>
    service.create(session.actor, { request, key: crypto.randomUUID() })));
  await gate.entered;
  gate.release();
  // Then
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
  expect(provider.received).toHaveLength(1);
});

test("charges provider failures and regeneration but not idempotent replay", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  provider.status(429);
  const request = { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "agent" as const, tool: "chat" as const, prompt: "Regenerate", fileIds: [] };
  const failed = await fixture.run(session, request);
  expect(failed.status).toBe("failed");
  provider.status(200);
  const key = crypto.randomUUID();
  const finished = fixture.settled();
  const next = await fixture.ai.create(session.actor, { request, key });
  await finished;
  // When
  const replay = await fixture.ai.create(session.actor, { request, key });
  // Then
  expect(replay.id).toBe(next.id);
  expect(provider.received).toHaveLength(2);
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(2);
});

test("refunds retrieval setup failure before the model is dispatched", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  // When
  const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "citation-reviewer", prompt: "Retrieve", fileIds: [] });
  // Then
  expect(run.status).toBe("failed");
  expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("AI_RETRIEVAL_CONSENT");
  expect(provider.received).toHaveLength(0);
  expect(await fixture.ai.store.usage(session.actor, "2026-10")).toMatchObject({ used: 0, refunded: 1, reserved: 0 });
});
