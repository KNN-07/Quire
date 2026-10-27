import { expect, test } from "bun:test";
import { z } from "zod";
import * as Y from "yjs";
import { ThreadSchema } from "@quire/contracts";
import { reviewFixture, sourceDoc, proposal, mutation } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("keeps a comment selection attached when a collaborator inserts source before it", async () => {
  // Given: a real comment selecting an existing source range through Yjs relative positions.
  await using fixture = await reviewFixture();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const doc = sourceDoc(fixture.service.loadDocument(scope, ids.mainFile).state);
  const edit = proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 });
  const created = await fixture.request(`/api/projects/${ids.project}/threads`,
    mutation(reviewer.headers, { scope, anchor: edit.anchor, body: "Selected range", expectedVersion: 0 }));
  const thread = z.object({ data: ThreadSchema }).parse(await created.json()).data;
  const prefix = "% collaborator 😀\n";
  doc.getText("source").insert(0, prefix);
  // When: a genuine shared-source writer inserts before the selected comment range.
  await fixture.service.serialized(scope, () => fixture.service.commitSource({ actorId: ids.mai, scope, expectedRevision: 0,
    inputs: fixture.service.listFiles(scope).map(file => ({ file, ...(file.id === ids.mainFile ? { document: doc } : {}) })) }));
  const response = await fixture.request(`/api/projects/${ids.project}/threads/${thread.id}?branch=main`, { headers: reviewer.headers });
  const current = z.object({ data: ThreadSchema }).parse(await response.json()).data;
  if (!current.anchor) throw new TypeError("Expected attached comment");
  const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(current.anchor.startRelative, "base64")), doc);
  const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(current.anchor.endRelative, "base64")), doc);
  if (!start || !end) throw new TypeError("Expected resolvable relative positions");
  // Then: the same comment still selects the original text at its shifted position.
  expect(doc.getText("source").toJSON().slice(start.index, end.index)).toBe("article");
  expect(start.index).toBeGreaterThan(prefix.length);
  expect(current.id).toBe(thread.id);
  doc.destroy();
});

test("recovers an empty insertion anchor at its exact checkpoint offset rather than the first empty quote", async () => {
  // Given: a history checkpoint with a zero-length anchored comment away from index zero.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const doc = sourceDoc(fixture.service.loadDocument(scope, ids.mainFile).state);
  const text = doc.getText("source");
  const offset = text.toJSON().indexOf("\\begin{document}");
  const position = Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, offset))).toString("base64");
  const created = await fixture.request(`/api/projects/${ids.project}/threads`,
    mutation(owner.headers, { scope, anchor: { fileId: ids.mainFile, epoch: 0, startRelative: position,
      endRelative: position, quote: "" }, body: "Insertion here", expectedVersion: 0 }));
  const thread = z.object({ data: ThreadSchema }).parse(await created.json()).data;
  const checkpoint = await fixture.service.snapshot(owner.user.id, scope, 0);
  text.insert(0, "% changed\n");
  await fixture.service.serialized(scope, () => fixture.service.commitSource({ actorId: owner.user.id, scope, expectedRevision: 0,
    inputs: fixture.service.listFiles(scope).map(file => ({ file, ...(file.id === ids.mainFile ? { document: doc } : {}) })) }));
  // When: project history restores both the source checkpoint and eligible review metadata.
  const restored = await fixture.request(`/api/projects/${ids.project}/history/${checkpoint.id}/restore`,
    mutation(owner.headers, { scope, expectedVersion: 1 }));
  expect(restored.status).toBe(200);
  const response = await fixture.request(`/api/projects/${ids.project}/threads/${thread.id}?branch=main`, { headers: owner.headers });
  const current = z.object({ data: ThreadSchema }).parse(await response.json()).data;
  if (!current.anchor) throw new TypeError("Expected recovered insertion anchor");
  const source = sourceDoc(fixture.service.loadDocument(scope, ids.mainFile).state);
  const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(current.anchor.startRelative, "base64")), source);
  // Then: recovery uses the immutable checkpoint position, even though every offset matches an empty quote.
  expect(start?.index).toBe(offset);
  expect(current.anchor.epoch).toBe(1);
  source.destroy(); doc.destroy();
});
