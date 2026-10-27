import { expect, test } from "bun:test";
import { z } from "zod";
import { ThreadSchema, SuggestionSchema, HistoryVersionSchema, FileEntrySchema, IdSchema } from "@quire/contracts";
import * as Y from "yjs";
import { reviewFixture, peer, sourceDoc, proposal, mutation } from "../core/review/harness";
import { fixtureIds as ids } from "../fixtures/foundation";
import { readZip } from "../../services/core/base";

test("accepts only selected anchored suggestions without overwriting a subscribed collaborator", async () => {
  // Given: two subscribed clients and a reviewer proposal anchored to the shared source.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const editor = await fixture.login("mai@quire.local");
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const base = fixture.service.loadDocument(scope, ids.mainFile);
  const doc = sourceDoc(base.state);
  const chosen = proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: base.revision });
  const omitted = proposal(doc, { fileId: ids.mainFile, before: "\\begin{document}",
    after: "\\begin{document}\nUNSELECTED", baseRevision: base.revision });
  const created = await fixture.request(`/api/projects/${ids.project}/suggestions`,
    mutation(reviewer.headers, { scope, edits: [chosen, omitted], expectedVersion: base.revision }));
  const suggestion = z.object({ data: SuggestionSchema }).parse(await created.json()).data;
  const selectedId = suggestion.edits[0]?.id;
  if (!selectedId) throw new TypeError("Expected proposed edit");
  await using left = await peer(fixture.url, scope, owner.headers);
  await using right = await peer(fixture.url, scope, editor.headers);
  const synced = [left.next(message => message.type === "update"), right.next(message => message.type === "update")];
  left.send({ type: "sync", fileId: ids.mainFile, epoch: 0, stateVectorBase64: base.vector });
  right.send({ type: "sync", fileId: ids.mainFile, epoch: 0, stateVectorBase64: base.vector });
  await Promise.all(synced);
  const editDoc = sourceDoc(base.state);
  editDoc.getText("source").insert(editDoc.getText("source").length, "\nCOLLABORATOR");
  const ack = right.next(message => message.type === "ack");
  right.send({ type: "update", fileId: ids.mainFile, epoch: 0, clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
    updateBase64: Buffer.from(Y.encodeStateAsUpdate(editDoc, Buffer.from(base.vector, "base64"))).toString("base64") });
  await ack;
  const leftChanged = left.next(message => message.type === "update" && message.revision === base.revision + 2);
  const rightChanged = right.next(message => message.type === "update" && message.revision === base.revision + 2);
  // When: the editor accepts just one edit after the independent collaborator save.
  const decision = mutation(owner.headers, { ids: [suggestion.id], editIds: [selectedId], decision: "accept",
    expectedVersion: fixture.service.getBranch(scope).revision });
  const decided = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`, decision);
  const result = z.object({ data: z.array(SuggestionSchema) }).parse(await decided.json()).data;
  await Promise.all([leftChanged, rightChanged]);
  const retry = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`, decision);
  // Then: only the selected proposal applied, both live clients saw it, and the concurrent work survived.
  expect(z.object({ data: z.array(SuggestionSchema) }).parse(await retry.json()).data).toEqual(result);
  expect(result[0]?.edits.map(edit => edit.status)).toEqual(["accepted", "pending"]);
  const text = fixture.service.loadDocument(scope, ids.mainFile).text;
  expect(text).toContain(base.text.replace("article", "report"));
  expect(text).toContain("COLLABORATOR");
  expect(text).not.toContain("UNSELECTED");
  doc.destroy(); editDoc.destroy();
});


test("restores deleted files and immutable history without resurrecting permanently deleted comments", async () => {
  // Given: an anchored thread captured in a real immutable source checkpoint.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const baseline = fixture.service.loadDocument(scope, ids.mainFile);
  const doc = sourceDoc(baseline.state);
  const anchored = proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: baseline.revision });
  const threadResponse = await fixture.request(`/api/projects/${ids.project}/threads`,
    mutation(reviewer.headers, { scope, anchor: anchored.anchor, body: "@Kien review", expectedVersion: baseline.revision }));
  const thread = z.object({ data: ThreadSchema }).parse(await threadResponse.json()).data;
  const comment = thread.comments[0];
  if (!comment) throw new TypeError("Expected thread comment");
  const extraResponse = await fixture.request(`/api/projects/${ids.project}/files`,
    mutation(owner.headers, { scope, path: "recover.tex", kind: "file", text: "RECOVER ME", expectedVersion: baseline.revision }));
  const extra = z.object({ data: FileEntrySchema }).parse(await extraResponse.json()).data;
  const checkpoint = await fixture.service.snapshot(owner.user.id, scope, fixture.service.getBranch(scope).revision);
  const list = await fixture.request(`/api/projects/${ids.project}/history?branch=main`, { headers: owner.headers });
  const versions = z.object({ data: z.object({ items: z.array(HistoryVersionSchema) }) }).parse(await list.json()).data.items;
  const saved = versions.find(version => version.snapshot.id === checkpoint.id);
  if (!saved) throw new TypeError("Missing durable history version");
  // When: the author permanently deletes the comment, the file is deleted, and just that file is restored.
  const deleted = await fixture.request(`/api/projects/${ids.project}/comments/${comment.id}`, {
    method: "DELETE", headers: reviewer.headers, body: JSON.stringify({ expectedVersion: 0 }),
  });
  expect(deleted.status).toBe(200);
  const removed = await fixture.request(`/api/projects/${ids.project}/files/${extra.id}`, {
    method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ scope, expectedVersion: fixture.service.getBranch(scope).revision }),
  });
  expect(removed.status).toBe(200);
  const mainBefore = fixture.service.loadDocument(scope, ids.mainFile);
  const restore = mutation(owner.headers, { scope, fileIds: [extra.id], expectedVersion: fixture.service.getBranch(scope).revision });
  const response = await fixture.request(`/api/projects/${ids.project}/history/${saved.id}/restore`, restore);
  const restored = z.object({ data: HistoryVersionSchema }).parse(await response.json()).data;
  const replay = await fixture.request(`/api/projects/${ids.project}/history/${saved.id}/restore`, restore);
  // Then: recovered source is a new checkpoint, unrelated source is byte-identical, and tombstones survive restart.
  expect(z.object({ data: HistoryVersionSchema }).parse(await replay.json()).data.id).toBe(restored.id);
  expect(restored.id).not.toBe(saved.id);
  expect(fixture.service.loadDocument(scope, extra.id).text).toBe("RECOVER ME");
  expect(fixture.service.loadDocument(scope, ids.mainFile)).toEqual(mainBefore);
  await fixture.restart();
  const full = await fixture.request(`/api/projects/${ids.project}/history/${saved.id}/restore`,
    mutation(owner.headers, { scope, expectedVersion: fixture.service.getBranch(scope).revision }));
  expect(full.status).toBe(200);
  const current = await fixture.request(`/api/projects/${ids.project}/threads/${thread.id}?branch=main`, { headers: owner.headers });
  expect(z.object({ data: ThreadSchema }).parse(await current.json()).data.comments).toEqual([]);
  expect(fixture.runtime.db.query("SELECT 1 FROM permanent_comment_tombstones WHERE comment_id=?").get(comment.id)).not.toBeNull();
  doc.destroy();
});

test("rejects stale offline epochs after project restore and enforces history labels, compare, ZIP and access windows", async () => {
  // Given: a project checkpoint and an editor with an offline buffer.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const baseline = fixture.service.loadDocument(scope, ids.mainFile);
  const snapshot = await fixture.service.snapshot(owner.user.id, scope, baseline.revision);
  await using client = await peer(fixture.url, scope, owner.headers);
  const initialSync = client.next(message => message.type === "update");
  client.send({ type: "sync", fileId: ids.mainFile, epoch: baseline.epoch, stateVectorBase64: baseline.vector });
  await initialSync;
  const label = await fixture.request(`/api/projects/${ids.project}/history/${snapshot.id}/labels`,
    mutation(owner.headers, { name: "Before restore", expectedVersion: 0 }));
  expect(label.status).toBe(200);
  const invalidated = client.next(message => message.type === "error" && message.code === "EPOCH_CHANGED");
  const restoredResponse = await fixture.request(`/api/projects/${ids.project}/history/${snapshot.id}/restore`,
    mutation(owner.headers, { scope, expectedVersion: baseline.revision }));
  const restored = z.object({ data: HistoryVersionSchema }).parse(await restoredResponse.json()).data;
  expect(await invalidated).toMatchObject({ type: "error", code: "EPOCH_CHANGED", recoveryText: baseline.text });
  expect(client.messages.filter(message => message.type === "update" && message.epoch !== baseline.epoch)).toEqual([]);
  const offline = sourceDoc(baseline.state);
  offline.getText("source").insert(offline.getText("source").length, "OLD OFFLINE");
  const error = client.next(message => message.type === "error");
  // When: the stale offline update is sent and history is read through HTTP.
  client.send({ type: "update", fileId: ids.mainFile, epoch: baseline.epoch, clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
    updateBase64: Buffer.from(Y.encodeStateAsUpdate(offline)).toString("base64") });
  const comparison = await fixture.request(`/api/projects/${ids.project}/history/compare?branch=main&from=${snapshot.id}&to=${restored.id}`,
    { headers: owner.headers });
  const zip = await fixture.request(`/api/projects/${ids.project}/history/${snapshot.id}/source.zip?branch=main`, { headers: owner.headers });
  // Then: source never accepts old epochs, and real history endpoints expose immutable content.
  expect(await error).toMatchObject({ type: "error", code: "EPOCH_CHANGED", recoveryText: baseline.text });
  expect(fixture.service.loadDocument(scope, ids.mainFile).text).toBe(baseline.text);
  expect(comparison.status).toBe(200);
  expect(z.object({ data: z.object({ hunks: z.array(z.unknown()) }) }).parse(await comparison.json()).data.hunks).toEqual([]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  expect([...bytes.slice(0, 2)]).toEqual([80, 75]);
  expect(bytes.length).toBeGreaterThan(100);
  const archivedMain = readZip(bytes).find(file => file.path === "main.tex");
  expect(archivedMain ? new TextDecoder().decode(archivedMain.bytes) : null).toBe(baseline.text);
  const deletedLabel = z.object({ data: HistoryVersionSchema }).parse(await label.json()).data.labels[0];
  if (!deletedLabel) throw new TypeError("Expected label");
  const removeLabel = await fixture.request(`/api/projects/${ids.project}/history/${snapshot.id}/labels/${deletedLabel.id}`, {
    method: "DELETE", headers: owner.headers, body: JSON.stringify({ expectedVersion: 1 }),
  });
  expect(removeLabel.status).toBe(200);
  offline.destroy();
});
