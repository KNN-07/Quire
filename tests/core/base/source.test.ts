import { expect, test } from "bun:test";
import * as Y from "yjs";
import { ProposedEditSchema } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { git, repositoryPath } from "../../../services/core/base";
import { treeInputs } from "../../../services/core/git/trees";

test("persists and checkpoints an invalid draft of an already selected main", async () => {
  await using fixture = await baseFixture();
  const scope = { projectId: ids.project, branch: "main" };
  const original = await fixture.service.readDocument(scope, ids.mainFile);
  const invalid = original.text.replace("\\documentclass", "\\documentclas");
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, Buffer.from(original.updateBase64, "base64"));
    const source = document.getText("source");
    document.transact(() => { source.delete(0, source.length); source.insert(0, invalid); });
    const snapshot = await fixture.service.serialized(scope, async lease => fixture.service.commitSource({
      actorId: ids.kien, scope, lease, expectedRevision: (await fixture.service.getBranch(scope)).revision,
      inputs: (await fixture.service.listFiles(scope)).map(file => file.id === ids.mainFile ? { file, document } : { file }),
    }));
    await fixture.restart();
    expect((await fixture.service.readDocument(scope, ids.mainFile)).text).toBe(invalid);
    const checkpoint = await fixture.service.snapshot(ids.kien, scope, snapshot.revision);
    const inputs = await treeInputs(fixture.service, { scope, commit: checkpoint.tree });
    expect(inputs.find(input => input.file.id === ids.mainFile)?.file.blob).toBe(
      (await fixture.service.getFile(scope, ids.mainFile)).blob);
  } finally { document.destroy(); }
});

test("preserves Yjs relative anchors and Git blob consistency when applying a non-BMP edit", async () => {
  // Given: a genuine Yjs document and relative positions around a selected source range.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from((await fixture.service.loadDocument(scope, project.settings.mainFileId)).state, "base64"));
  const text = doc.getText("source");
  const start = text.toJSON().indexOf("\\begin{document}") + "\\begin{document}".length;
  const edit = ProposedEditSchema.parse({
    id: crypto.randomUUID(), fileId: project.settings.mainFileId,
    anchor: {
      fileId: project.settings.mainFileId, epoch: 0, quote: "",
      startRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start))).toString("base64"),
      endRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start))).toString("base64")
    },
    before: "", after: "😀漢字", baseRevision: 1, status: "pending"
  });
  doc.destroy();
  // When: ProjectPort applies the edit, retries it, and the runtime restarts.
  const result = await fixture.service.applyEdits(owner.user.id, scope, [edit], "unicode-edit");
  const replay = await fixture.service.applyEdits(owner.user.id, scope, [edit], "unicode-edit");
  await fixture.restart();
  const resumed = await fixture.service.applyEdits(owner.user.id, scope, [edit], "unicode-edit");
  // Then: source, Yjs, immutable snapshot blobs and actual hidden Git trees agree.
  expect(result).toEqual(replay);
  expect(resumed).toEqual(result);
  const actual = (await fixture.service.readDocument(scope, project.settings.mainFileId));
  expect(actual.text).toContain("😀漢字");
  expect(actual.text.match(/😀漢字/gu)).toHaveLength(1);
  const snapshot = await fixture.service.snapshot(owner.user.id, scope, result.revision);
  const tree = await git(repositoryPath(fixture.service.context, project.id),
    ["show", `refs/quire/history/${snapshot.id}:main.tex`]);
  expect(tree).toBe(actual.text.trim());
  const state = new Y.Doc();
  try {
    Y.applyUpdate(state, Buffer.from(actual.updateBase64, "base64"));
    expect(state.getText("source").toJSON()).toBe(actual.text);
  } finally { state.destroy(); }
});

test("rejects an edit that splits a UTF-16 surrogate pair without changing any source store", async () => {
  // Given: a genuine Unicode source document and an anchor selecting half an emoji.
  await using fixture = await baseFixture();
  const project = await fixture.service.createFromFiles(ids.kien, {
    name: "Unicode boundary", entries: [
      { path: "main.tex", bytes: new TextEncoder().encode("\\documentclass{article}\n😀\n") },
    ]
  });
  const scope = { projectId: project.id, branch: "main" };
  const original = (await fixture.service.readDocument(scope, project.settings.mainFileId));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(original.updateBase64, "base64"));
  const text = doc.getText("source");
  const start = text.toJSON().indexOf("😀");
  const edit = ProposedEditSchema.parse({
    id: crypto.randomUUID(), fileId: project.settings.mainFileId,
    anchor: {
      fileId: project.settings.mainFileId, epoch: 0, quote: "",
      startRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start))).toString("base64"),
      endRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start + 1))).toString("base64")
    },
    before: original.text.slice(start, start + 1), after: "", baseRevision: 1, status: "pending"
  });
  doc.destroy();
  // When: the shared source port attempts the edit.
  const result = await fixture.service.applyEdits(ids.kien, scope, [edit], "split-surrogate");
  // Then: invalid Unicode never diverges between Yjs, UTF-8 blobs and source.
  expect(result.conflicts).toEqual([edit.id]);
  expect((await fixture.service.readDocument(scope, project.settings.mainFileId))).toEqual(original);
  expect((await fixture.service.getBranch(scope)).revision).toBe(1);
});

test("applies none of a selected edit batch when a relative anchor diverges", async () => {
  // Given: a relative anchor with an exact-before mismatch.
  await using fixture = await baseFixture();
  const scope = { projectId: ids.project, branch: "main" };
  const source = (await fixture.service.readDocument(scope, ids.mainFile));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(source.updateBase64, "base64"));
  const text = doc.getText("source");
  const position = Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 0))).toString("base64");
  const edit = ProposedEditSchema.parse({
    id: crypto.randomUUID(), fileId: ids.mainFile,
    anchor: { fileId: ids.mainFile, epoch: 0, quote: "mismatch", startRelative: position, endRelative: position },
    before: "not the original", after: "wrong", baseRevision: (await fixture.service.getBranch(scope)).revision, status: "pending"
  });
  doc.destroy();
  // When: the shared port applies this batch.
  const result = await fixture.service.applyEdits(ids.kien, scope, [edit], "conflict");
  // Then: it reports conflict without a partial source revision.
  expect(result.conflicts).toEqual([edit.id]);
  expect((await fixture.service.readDocument(scope, ids.mainFile)).text).toBe(source.text);
  expect((await fixture.service.getBranch(scope)).revision).toBe(result.revision);
});

test("rejects a stale snapshot before publishing a hidden ref", async () => {
  // Given: the current source branch.
  await using fixture = await baseFixture();
  const scope = { projectId: ids.project, branch: "main" };
  // When: a consumer requests a stale compile/source revision.
  const failure = await fixture.service.snapshot(ids.kien, scope, (await fixture.service.getBranch(scope)).revision + 1)
    .then(() => null, (error: unknown) => error);
  // Then: it gets an optimistic concurrency conflict rather than mixed source.
  expect(failure).toMatchObject({ code: "STALE_VERSION", status: 409 });
});
