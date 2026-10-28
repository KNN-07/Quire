import { test, expect } from "bun:test";
import { gitFixture, operationEnvelope } from "./harness";
import { repositoryPath } from "../../../services/core/base";
import { run } from "../../../services/core/git/process";
import { FileEntrySchema, IdSchema } from "@quire/contracts";

test("T11 commits only a user's selected hunk while preserving unstaged browser edits", async () => {
  // Given: two separated changes in a real durable browser source.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const service = fixture.service();
  const baseline = "\\documentclass{article}\n" + Array.from({ length: 24 }, (_, i) => `line ${i}\n`).join("");
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
    expectedRevision: (await service.getBranch(scope)).revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(baseline) })) }));
  await fixture.status(owner.headers, project.id);
  const changed = baseline.replace("line 1\n", "first edit\n").replace("line 22\n", "last edit\n");
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
    expectedRevision: (await service.getBranch(scope)).revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(changed) })) }));
  const status = await fixture.status(owner.headers, project.id);
  const selected = status.hunks[0];
  if (!selected) throw new TypeError("Expected separated hunks");
  expect(status.hunks).toHaveLength(2);
  await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
    body: JSON.stringify({ scope, head: status.head, hunkIds: [selected.id], staged: true, expectedVersion: status.revision }) });
  // When: the user commits the one selected hunk.
  const response = await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, head: status.head, message: "One hunk", compileFirst: false, expectedVersion: status.revision }) });
  const data: unknown = await response.json();
  expect(response.status, JSON.stringify(fixture.failures)).toBe(202);
  const operation = operationEnvelope.parse(data).data;
  // Then: real Git has only the first edit; the browser still has both.
  expect(operation.status).toBe("succeeded");
  const committed = await run({ path: repositoryPath(service.context, project.id), args: ["show", "main:main.tex"] });
  expect(committed.text).toContain("first edit");
  expect(committed.text).toContain("line 22");
  expect((await service.readDocument(scope, project.settings.mainFileId)).text).toBe(changed);
  expect((await fixture.status(owner.headers, project.id)).hunks).toHaveLength(1);
});

test("T11 rejects stale hunk selection and discards only a current selected hunk", async () => {
  // Given: a named branch with a later browser edit.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const before = await fixture.status(owner.headers, project.id);
  const service = fixture.service();
  const original = (await service.readDocument(scope, project.settings.mainFileId)).text;
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
    expectedRevision: before.revision, inputs: (await service.listFiles(scope)).map(file => ({
      file, bytes: new TextEncoder().encode(`${original}% browser edit\n`),
    })) }));
  const status = await fixture.status(owner.headers, project.id);
  // When: stale staging is refused and the current hunk is discarded.
  const stale = await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${before.revision}"` },
    body: JSON.stringify({ scope, head: before.head, hunkIds: [], staged: true, expectedVersion: before.revision }) });
  const discard = await fixture.request(`/api/projects/${project.id}/git/discard`, { method: "POST", headers: owner.headers,
    body: JSON.stringify({ scope, head: status.head, hunkIds: status.hunks.map(hunk => hunk.id), expectedVersion: status.revision }) });
  // Then: stale writes fail and the browser source returns to the named tree.
  expect(stale.status).toBe(409);
  expect(discard.status).toBe(200);
  expect((await service.readDocument(scope, project.settings.mainFileId)).text).toBe(original);
  expect((await fixture.status(owner.headers, project.id)).head).toBe(before.head);
});

test("T11 keeps staging private to each authenticated editor", async () => {
  // Given: two real editors and a modified source tree.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const editor = await fixture.login("alex@quire.local");
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  await fixture.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)",
    [crypto.randomUUID(), project.id, editor.user.id, "2026-10-26T12:00:00.000Z"]);
  const service = fixture.service();
  const before = await fixture.status(owner.headers, project.id);
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope, expectedRevision: before.revision,
    inputs: await Promise.all((await service.listFiles(scope)).map(async file => ({ file, bytes: new TextEncoder().encode((await service.readDocument(scope, file.id)).text + "% staged\n") }))) }));
  const status = await fixture.status(owner.headers, project.id);
  // When: only the owner stages the changed hunk.
  const response = await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
    body: JSON.stringify({ scope, head: status.head, hunkIds: status.hunks.map(hunk => hunk.id), staged: true, expectedVersion: status.revision }) });
  // Then: the other editor's status shows the same diff but no selected hunks.
  expect(response.status).toBe(200);
  expect((await fixture.status(owner.headers, project.id)).staged).toHaveLength(1);
  const other = await fixture.status(editor.headers, project.id);
  expect(other.staged).toHaveLength(0);
  expect(other.hunks).toHaveLength(1);
});

test("T11 stages an actual binary addition into real Git objects", async () => {
  // Given: a browser tree with an added binary file.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const before = await fixture.status(owner.headers, project.id);
  const service = fixture.service();
  const bytes = new Uint8Array([0, 255, 3, 0, 37, 91]);
  const file = FileEntrySchema.parse({ id: IdSchema.parse(crypto.randomUUID()), path: "figure.bin", kind: "file",
    mime: "application/octet-stream", blob: null, bytes: bytes.length, editable: false, link: null, version: { revision: 0, epoch: 0 } });
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope,
    expectedRevision: before.revision, inputs: [...(await service.listFiles(scope)).map(entry => ({ file: entry })), { file, bytes }] }));
  const status = await fixture.status(owner.headers, project.id);
  await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${status.revision}"` },
    body: JSON.stringify({ scope, head: status.head, hunkIds: status.hunks.map(hunk => hunk.id), staged: true, expectedVersion: status.revision }) });
  // When: a normal staged commit publishes the binary object.
  const response = await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, head: status.head, message: "Binary", compileFirst: false, expectedVersion: status.revision }) });
  // Then: the repository returns exactly the original binary bytes.
  expect(response.status).toBe(202);
  expect((await run({ path: repositoryPath(service.context, project.id), args: ["show", "main:figure.bin"] })).bytes).toEqual(bytes);
});

test("T11 preserves staged bytes when browser edits continue before commit", async () => {
  // Given: a staged source edit followed by a different later browser edit.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const service = fixture.service();
  const before = await fixture.status(owner.headers, project.id);
  const original = (await service.readDocument(scope, project.settings.mainFileId)).text;
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope, expectedRevision: before.revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(`${original}% staged value\n`) })) }));
  const staged = await fixture.status(owner.headers, project.id);
  await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${staged.revision}"` },
    body: JSON.stringify({ scope, head: staged.head, hunkIds: staged.hunks.map(hunk => hunk.id), staged: true, expectedVersion: staged.revision }) });
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope, expectedRevision: staged.revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(`${original}% later browser value\n`) })) }));
  await fixture.restart();
  const current = await fixture.status(owner.headers, project.id);
  // When: the user commits the persisted staging area after restart.
  const response = await fixture.request(`/api/projects/${project.id}/git/commit`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, head: current.head, message: "Preserved stage", compileFirst: false, expectedVersion: current.revision }) });
  // Then: the named commit has staged bytes and the live browser retains its newer text.
  expect(response.status, JSON.stringify(fixture.failures)).toBe(202);
  expect((await run({ path: repositoryPath(fixture.service().context, project.id), args: ["show", "main:main.tex"] })).text)
    .toContain("% staged value");
  expect((await fixture.service().readDocument(scope, project.settings.mainFileId)).text).toBe(`${original}% later browser value\n`);
});

test("T11 unstages a selected hunk without changing working source or named history", async () => {
  // Given: a real staged hunk.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const service = fixture.service();
  const before = await fixture.status(owner.headers, project.id);
  const text = (await service.readDocument(scope, project.settings.mainFileId)).text + "% keep source\n";
  await service.serialized(scope, async lease => service.commitSource({ lease, actorId: owner.user.id, scope, expectedRevision: before.revision,
    inputs: (await service.listFiles(scope)).map(file => ({ file, bytes: new TextEncoder().encode(text) })) }));
  const status = await fixture.status(owner.headers, project.id);
  const body = { scope, head: status.head, hunkIds: status.hunks.map(hunk => hunk.id), staged: true, expectedVersion: status.revision };
  const headers = { ...owner.headers, "if-match": `"v${status.revision}"` };
  await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT", headers, body: JSON.stringify(body) });
  // When: the owner unstages the same hunk.
  const response = await fixture.request(`/api/projects/${project.id}/git/stage`, { method: "PUT", headers,
    body: JSON.stringify({ ...body, staged: false }) });
  // Then: the diff remains, but its selection and only its selection is removed.
  expect(response.status).toBe(200);
  const after = await fixture.status(owner.headers, project.id);
  expect(after.staged).toHaveLength(0);
  expect(after.hunks).toHaveLength(1);
  expect(after.head).toBe(before.head);
  expect((await service.readDocument(scope, project.settings.mainFileId)).text).toBe(text);
});
