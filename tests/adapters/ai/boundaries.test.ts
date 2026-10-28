import { expect, test } from "bun:test";
import { assertNever, parseResourceVersionTag } from "@quire/contracts";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { aiFixture, failure, runSchema } from "./harness";
import { providerServer } from "./provider";

test("sends only the explicit selection and not other source text", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const document = await fixture.core.readDocument(scope, project.settings.mainFileId);
  const text = document.text.slice(0, 5);
  // When
  await fixture.run(session, { scope, mode: "ask", tool: "grammar", prompt: "Check", fileIds: [document.file.id],
    selection: { fileId: document.file.id, from: 0, to: 5, text } });
  // Then
  expect(provider.contexts[0]?.files).toEqual([{ id: document.file.id, path: document.file.path, from: 0, to: 5, text }]);
});

test.each(["consent", "organization", "user", "project"] as const)("denies %s authority before a provider request", async kind => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  switch (kind) {
    case "consent": await fixture.runtime.db.run("UPDATE identity_ai_consent SET accepted=0 WHERE user_id=?", [session.user.id]); break;
    case "organization": await fixture.runtime.db.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify(defaultPolicy), session.user.id]); break;
    case "user": await fixture.runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'user',?,?,?)",
      [crypto.randomUUID(), session.user.id, JSON.stringify(defaultPolicy), fixture.clock.now()]); break;
    case "project": await fixture.runtime.db.run("UPDATE policy_sets SET policy_json=? WHERE scope_kind='project' AND scope_id=?",
      [JSON.stringify(defaultPolicy), project.id]); break;
    default: assertNever(kind);
  }
  // When
  const error = await failure(fixture.ai.create(session.actor, { key: crypto.randomUUID(), request: {
    scope: { projectId: project.id, branch: project.defaultBranch }, mode: "agent", tool: "chat", prompt: "Denied", fileIds: [project.settings.mainFileId],
  } }));
  // Then
  expect(error.code).toBe(kind === "consent" ? "AI_CONSENT_REQUIRED" : "AI_POLICY_DENIED");
  expect(provider.received).toHaveLength(0);
});

test("rejects all selected proposals through the authenticated HTTP decision route", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Change", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% proposed\n",
  })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Change", fileIds: [original.file.id] });
  const current = await fixture.request(`/api/ai/runs/${run.id}`, { headers: session.headers });
  // When
  const response = await fixture.request(`/api/ai/runs/${run.id}/decide`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: parseResourceVersionTag(current.headers.get("etag")), editIds: [], decision: "reject" }),
  });
  // Then
  expect(response.status).toBe(200);
  expect(runSchema.parse(await response.json()).data.proposals[0]?.edits[0]?.status).toBe("rejected");
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
});

test("clears local session history before the next invocation", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "local-canary-history", fileIds: [] });
  // When
  await fixture.ai.conversations.clearSession(session.actor, scope);
  await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "Fresh", fileIds: [] });
  // Then
  expect(provider.received.at(-1)?.messages).toHaveLength(2);
  expect(JSON.stringify(provider.received.at(-1))).not.toContain("local-canary-history");
});
