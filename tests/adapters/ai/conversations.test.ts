import { expect, test } from "bun:test";
import { aiFixture, failure } from "./harness";
import { providerServer } from "./provider";

test("shares only explicitly created conversations with current collaborators", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login(); await fixture.configure(); const project = await fixture.project(owner);
  const collaborator = await fixture.login("mai@quire.local");
  await fixture.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)",
    [crypto.randomUUID(), project.id, collaborator.user.id, fixture.clock.now()]);
  const conversation = await fixture.ai.conversations.create(owner.actor, project.id);
  // When
  const run = await fixture.run(owner, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "chat", prompt: "Explicitly shared", fileIds: [], conversationId: conversation.id });
  // Then
  expect((await fixture.ai.get(collaborator.actor, run.id)).run.messages[0]?.text).toBe("Explicitly shared");
  expect((await fixture.ai.conversations.get(collaborator.actor, { id: conversation.id, projectId: project.id })).messages).toHaveLength(2);
});

test("clear discards a late result and removes persisted shared chat", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login(); await fixture.configure(); const project = await fixture.project(owner);
  const conversation = await fixture.ai.conversations.create(owner.actor, project.id);
  const gate = provider.gate(); const finished = fixture.settled();
  const run = await fixture.ai.create(owner.actor, { key: crypto.randomUUID(), request: {
    scope: { projectId: project.id, branch: project.defaultBranch }, mode: "ask", tool: "chat",
    prompt: "Pending private material", fileIds: [], conversationId: conversation.id,
  } });
  await gate.entered;
  // When
  await fixture.ai.conversations.clear(owner.actor, { id: conversation.id, projectId: project.id, expectedVersion: 0 });
  gate.release(); await finished;
  // Then
  expect((await fixture.ai.get(owner.actor, run.id)).run.status).toBe("canceled");
  expect(await failure(fixture.ai.conversations.get(owner.actor, { id: conversation.id, projectId: project.id })))
    .toMatchObject({ code: "AI_CONVERSATION_NOT_FOUND" });
  const stored = await fixture.runtime.db.get<{ messages_json: string }>("SELECT messages_json FROM ai_conversations WHERE id=?", [conversation.id]);
  expect(stored?.messages_json).toBe("[]");
});

test("retention removes expired shared messages", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const conversation = await fixture.ai.conversations.create(session.actor, project.id);
  const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "chat", prompt: "Retained temporarily", fileIds: [], conversationId: conversation.id });
  fixture.clock.advance(31 * 86400_000);
  // When
  await fixture.ai.conversations.expire();
  // Then
  const stored = await fixture.runtime.db.get<{ messages_json: string }>("SELECT messages_json FROM ai_runs WHERE id=?", [run.id]);
  expect(stored?.messages_json).toBe("[]");
  expect(await failure(fixture.ai.conversations.get(session.actor, { id: conversation.id, projectId: project.id })))
    .toMatchObject({ code: "AI_CONVERSATION_NOT_FOUND" });
});
