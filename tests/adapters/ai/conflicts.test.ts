import { expect, test } from "bun:test";
import { aiFixture, failure } from "./harness";
import { providerServer } from "./provider";

test("marks a stale base-text proposal as conflict without overwriting concurrent source", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Replace", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: file.text.length, before: file.text, after: "AI replacement",
  })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "paraphrase", prompt: "Rewrite", fileIds: [original.file.id] });
  await fixture.core.serialized(scope, lease => fixture.core.commitSource({ actorId: session.user.id, scope, lease,
    expectedRevision: original.file.version.revision, inputs: [{ file: original.file, bytes: new TextEncoder().encode("Concurrent human edit") }] }));
  // When
  const result = await fixture.ai.decisions.decide(session.actor, { id: run.id, editIds: [], decision: "accept",
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() });
  // Then
  expect(result.proposals[0]?.edits[0]?.status).toBe("conflict");
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe("Concurrent human edit");
});

test("denies proposal acceptance after current confidential policy changes", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Insert", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "Forbidden",
  })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "chat", prompt: "Add", fileIds: [original.file.id] });
  await fixture.ai.store.setSecurity(session.actor, { scope, confidential: true, expectedVersion: 0 });
  // When / Then
  expect(await failure(fixture.ai.decisions.decide(session.actor, { id: run.id, editIds: [], decision: "accept",
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() })))
    .toMatchObject({ code: "AI_CONFIDENTIAL" });
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
});

test("rejects provider path traversal before exposing a proposal", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  provider.respond(context => ({ text: "Unsafe", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: "../secret.tex", from: 0, to: 0, before: "", after: "Bad",
  })) }));
  // When
  const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Edit", fileIds: [project.settings.mainFileId] });
  // Then
  expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("AI_PATCH_INVALID");
  expect(run.proposals).toHaveLength(0);
});

test("serializes competing acceptance so one proposal is applied only once", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Insert", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% once\n",
  })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "chat", prompt: "Add", fileIds: [original.file.id] });
  const expectedVersion = (await fixture.ai.get(session.actor, run.id)).version;
  // When
  const outcomes = await Promise.allSettled([1, 2].map(() => fixture.ai.decisions.decide(session.actor, {
    id: run.id, editIds: [], decision: "accept", expectedVersion, key: crypto.randomUUID(),
  })));
  // Then
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(`% once\n${original.text}`);
});
