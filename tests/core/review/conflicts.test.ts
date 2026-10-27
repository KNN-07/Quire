import { expect, test } from "bun:test";
import { z } from "zod";
import * as Y from "yjs";
import { SuggestionSchema, IdSchema } from "@quire/contracts";
import { reviewFixture, proposal, sourceDoc, mutation, peer } from "./harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

test("marks exact-before divergence as conflict without applying another selected edit", async () => {
  // Given: a genuine two-edit suggestion anchored to the source.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const source = fixture.service.loadDocument(scope, ids.mainFile);
  const doc = sourceDoc(source.state);
  const changed = proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 });
  const unchanged = proposal(doc, { fileId: ids.mainFile, before: "\\begin{document}",
    after: "\\begin{document}\nNO PARTIAL", baseRevision: 0 });
  const response = await fixture.request(`/api/projects/${ids.project}/suggestions`,
    mutation(reviewer.headers, { scope, edits: [changed, unchanged], expectedVersion: 0 }));
  const suggestion = z.object({ data: SuggestionSchema }).parse(await response.json()).data;
  const text = doc.getText("source");
  const index = text.toJSON().indexOf("article");
  text.delete(index, "article".length); text.insert(index, "book");
  await fixture.service.serialized(scope, () => fixture.service.commitSource({ actorId: owner.user.id, scope, expectedRevision: 0,
    inputs: fixture.service.listFiles(scope).map(file => ({ file, ...(file.id === ids.mainFile ? { document: doc } : {}) })) }));
  const before = fixture.service.loadDocument(scope, ids.mainFile).text;
  // When: both edits are selected for acceptance after one exact-before range diverged.
  const decision = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`,
    mutation(owner.headers, { ids: [suggestion.id], decision: "accept", expectedVersion: 1 }));
  const result = z.object({ data: z.array(SuggestionSchema) }).parse(await decision.json()).data;
  // Then: the divergent edit is a conflict, its sibling stays pending, and no partial source is committed.
  expect(result[0]?.edits.map(edit => edit.status)).toEqual(["conflict", "pending"]);
  expect(fixture.service.loadDocument(scope, ids.mainFile).text).toBe(before);
  expect(fixture.service.getBranch(scope).revision).toBe(1);
  doc.destroy();
});

test("rejects unknown Yjs shared types without persisting source", async () => {
  // Given: a real editor connection and the original Yjs document.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const source = fixture.service.loadDocument(scope, ids.mainFile);
  await using client = await peer(fixture.url, scope, owner.headers);
  const doc = sourceDoc(source.state);
  doc.getMap("foreign").set("secret", "forbidden");
  const clientId = IdSchema.parse(crypto.randomUUID());
  // When: an otherwise-valid Yjs update attempts to smuggle an unrelated shared root.
  const rejected = client.next(message => message.type === "error");
  client.send({ type: "update", fileId: ids.mainFile, epoch: 0, clientId, clientSeq: 1,
    updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") });
  // Then: server validation rejects it before source revision, blob references or acknowledgement.
  expect(await rejected).toMatchObject({ type: "error", code: "INVALID_UPDATE" });
  expect(fixture.service.loadDocument(scope, ids.mainFile).text).toBe(source.text);
  expect(fixture.service.getBranch(scope).revision).toBe(0);
  doc.destroy();
});

test("keeps physical history while current policy denies old history content", async () => {
  // Given: immutable history and a one-day access policy, with a controlled clock.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const snapshot = await fixture.service.snapshot(owner.user.id, scope, 0);
  fixture.runtime.db.query(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
    VALUES(?,'project',?,?,?)`).run(crypto.randomUUID(), ids.project, JSON.stringify({ ...defaultPolicy, historyDays: 1 }), fixture.runtime.clock.now());
  fixture.setTime("2026-10-28T12:00:00.000Z");
  // When: the client reads the timeline and requests restricted source bytes.
  const timeline = await fixture.request(`/api/projects/${ids.project}/history?branch=main`, { headers: owner.headers });
  const dto = z.object({ data: z.object({ items: z.array(z.object({ id: IdSchema, accessible: z.boolean() })) }) }).parse(await timeline.json());
  const download = await fixture.request(`/api/projects/${ids.project}/history/${snapshot.id}/source.zip?branch=main`, { headers: owner.headers });
  // Then: metadata remains visible as inaccessible and immutable physical source is retained.
  expect(dto.data.items.find(item => item.id === snapshot.id)?.accessible).toBe(false);
  expect(download.status).toBe(403);
  expect(fixture.runtime.db.query("SELECT 1 FROM snapshots WHERE id=?").get(snapshot.id)).not.toBeNull();
});
