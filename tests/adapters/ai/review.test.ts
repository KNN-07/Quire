import { expect, test } from "bun:test";
import { FileEntrySchema } from "@quire/contracts";
import { z } from "zod";
import { aiFixture } from "./harness";
import { providerServer } from "./provider";

test("keeps multi-file patches inert until selected approval and preserves undo", async () => {
  // Given
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const response = await fixture.request(`/api/projects/${project.id}/files`, { method: "POST",
    headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, path: "chapter.tex", kind: "file", text: "Alpha", expectedVersion: (await fixture.core.getBranch(scope)).revision }) });
  const chapter = z.object({ data: FileEntrySchema }).parse(await response.json()).data;
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Two changes", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: file.from, to: file.from, before: "", after: "% reviewed\n",
  })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Add comments", fileIds: [original.file.id, chapter.id] });
  expect(run.status).toBe("succeeded");
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  const first = run.proposals[0]?.edits[0];
  const second = run.proposals[0]?.edits[1];
  if (!first || !second) throw new TypeError("Two proposed edits required");
  // When
  const accepted = await fixture.ai.decisions.decide(session.actor, { id: run.id, editIds: [first.id], decision: "accept",
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() });
  // Then
  expect(accepted.proposals[0]?.edits.map(edit => edit.status)).toEqual(["accepted", "pending"]);
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(`% reviewed\n${original.text}`);
  expect((await fixture.core.readDocument(scope, chapter.id)).text).toBe("Alpha");
});

test("undo restores accepted text through the core source writer", async () => {
  // Given
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Insert", citations: [], patches: context.files.map(file =>
    ({ fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% accepted\n" })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "grammar", prompt: "Add comment", fileIds: [original.file.id] });
  await fixture.ai.decisions.decide(session.actor, { id: run.id, editIds: [], decision: "accept",
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() });
  // When
  const undone = await fixture.ai.decisions.decide(session.actor, { id: run.id, editIds: [], decision: "undo",
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() });
  // Then
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  expect(undone.proposals[0]?.edits[0]?.status).toBe("rejected");
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(1);
});

test.each([true, false])("creates a real AI branch without changing the original branch (commit=%s)", async commit => {
  // Given
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Insert", citations: [], patches: context.files.map(file =>
    ({ fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% branch\n" })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Insert comment", fileIds: [original.file.id] });
  // When
  await fixture.ai.decisions.decide(session.actor, { id: run.id, editIds: [], decision: "accept", commit, newBranch: "ai/reviewed",
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() });
  // Then
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
  expect((await fixture.core.readDocument({ ...scope, branch: "ai/reviewed" }, original.file.id)).text).toBe(`% branch\n${original.text}`);
  const content = await fixture.runtime.repositories.read(project.id, ["show", "refs/heads/ai/reviewed:main.tex"]);
  expect(new TextDecoder().decode(content)).toBe(commit ? `% branch\n${original.text}` : original.text);
});
