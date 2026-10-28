import { expect, test } from "bun:test";
import * as Y from "yjs";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { changed, transportFixture } from "./harness";

test("converges two independent users and retains exact durable bytes after restart", async () => {
  // Given: two independently authenticated clients of the actual persistent realtime service.
  await using setup = await transportFixture();
  const owner = await setup.user();
  const editor = await setup.user("mai@quire.local");
  const left = owner.document;
  const right = editor.document;
  const converged = changed(right, () => right.source.toJSON().includes("OWNER 😀") && right.source.toJSON().includes("EDITOR 文"));
  const ownerConverged = changed(left, () => left.source.toJSON().includes("OWNER 😀") && left.source.toJSON().includes("EDITOR 文"));
  // When: concurrent overlapping insertions originate in two separate documents.
  left.replace([{ from: 0, to: 0, insert: "OWNER 😀\n" }]);
  right.replace([{ from: 0, to: 0, insert: "EDITOR 文\n" }]);
  await Promise.all([converged, ownerConverged, left.flush(AbortSignal.timeout(10000)), right.flush(AbortSignal.timeout(10000))]);
  const expected = left.source.toJSON();
  const state = Y.encodeStateAsUpdate(left.ydoc);
  await owner.transport.dispose();
  await editor.transport.dispose();
  await setup.fixture.restart();
  const saved = await setup.fixture.service.loadDocument(owner.workspace.scope, ids.mainFile);
  // Then: both byte representations and actual restart storage converge, without remote echo writes.
  expect(new TextEncoder().encode(right.source.toJSON())).toEqual(new TextEncoder().encode(expected));
  expect(new TextEncoder().encode(saved.text)).toEqual(new TextEncoder().encode(expected));
  expect(saved.revision).toBe(2);
  const reopened = await setup.user();
  expect(Y.encodeStateAsUpdate(reopened.document.ydoc)).toEqual(state);
  expect(reopened.document.source.toJSON()).toBe(expected);
  expect(await reopened.transport.open(reopened.document.file)).toBe(reopened.document);
});

test("retains ordered pending work through offline edits and a lost durable acknowledgement", async () => {
  // Given: a connection whose first durable ack will be lost on the real wire.
  await using setup = await transportFixture();
  const user = await setup.user();
  const document = user.document;
  user.dropNextAck();
  const offline = changed(document, () => document.getSnapshot().persistence.kind === "offline");
  // When: an ack is lost, more edits arrive offline, and the same document reconnects.
  document.replace([{ from: 0, to: 0, insert: "LOST ACK\n" }]);
  await offline;
  document.replace([{ from: 0, to: 0, insert: "OFFLINE ONE\n" }]);
  document.replace([{ from: 0, to: 0, insert: "OFFLINE TWO\n" }]);
  expect(document.getSnapshot().persistence).toMatchObject({ kind: "offline", pendingUpdates: 3 });
  user.transport.reconnect();
  await document.flush(AbortSignal.timeout(10000));
  // Then: replay uses the original bytes and sequence; all three edits persist exactly once.
  const saved = await setup.fixture.service.loadDocument(user.workspace.scope, ids.mainFile);
  expect(saved.text).toBe(document.source.toJSON());
  expect(saved.text.match(/LOST ACK/g)).toHaveLength(1);
  expect(saved.revision).toBe(3);
  expect(document.getSnapshot().persistence).toMatchObject({ kind: "saved", revision: 3 });
});
