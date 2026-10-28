import { expect, test } from "bun:test";
import * as Y from "yjs";
import { IdSchema } from "@quire/contracts";
import { TransportError } from "../../../apps/web/src/features/editor/transport";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { mutation, peer } from "../../core/review/harness";
import { changed, transportFixture } from "./harness";

test("rejects Viewer edits both through the consumer and the actual server protocol", async () => {
  // Given: a real named Viewer and the actual source baseline.
  await using setup = await transportFixture();
  const viewer = await setup.user("alex@quire.local");
  const before = viewer.document.source.toJSON();
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(viewer.document.ydoc));
  doc.getText("source").insert(0, "FORBIDDEN");
  await using raw = await peer(setup.fixture.url, viewer.workspace.scope, viewer.login.headers);
  const denied = raw.next(message => message.type === "error");
  // When: a consumer attempts an edit, then an independent hostile client bypasses the UI.
  expect(() => viewer.document.replace([{ from: 0, to: 0, insert: "FORBIDDEN" }])).toThrow();
  raw.send({ type: "update", fileId: ids.mainFile, epoch: 0, clientId: IdSchema.parse(crypto.randomUUID()),
    clientSeq: 1, updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") });
  // Then: current server authorization rejects the mutation and durable bytes are unchanged.
  expect(await denied).toMatchObject({ type: "error", code: "FORBIDDEN" });
  expect((await setup.fixture.service.loadDocument(viewer.workspace.scope, ids.mainFile)).text).toBe(before);
  doc.destroy();
});

test("makes a live editor read-only when its real membership is downgraded", async () => {
  // Given: an active editor and a separately authenticated owner.
  await using setup = await transportFixture();
  const editor = await setup.user("mai@quire.local");
  const owner = await setup.fixture.login();
  const readOnly = changed(editor.document, () => editor.document.getSnapshot().readOnly);
  // When: the owner downgrades the actual membership through HTTP.
  const response = await setup.fixture.request(`/api/projects/${ids.project}/members/${ids.mai}`, {
    method: "PATCH", headers: owner.headers, body: JSON.stringify({ role: "viewer", expectedVersion: 0 }),
  });
  await readOnly;
  // Then: the retained document immediately rejects new local edits without replacing its bytes.
  expect(response.status).toBe(200);
  expect(editor.document.getSnapshot().readOnly).toBe(true);
  expect(() => editor.document.replace([{ from: 0, to: 0, insert: "DENIED" }])).toThrow();
});

test("retains local recovery text when a session is revoked on a live socket", async () => {
  // Given: two sessions for one user, one with live document state.
  await using setup = await transportFixture();
  const removed = await setup.user();
  const retained = await setup.fixture.login();
  const recovery = changed(removed.document, () => removed.document.getSnapshot().persistence.kind === "recovery");
  const before = removed.document.source.toJSON();
  // When: another session revokes the active session using the real identity endpoint.
  const response = await setup.fixture.request("/api/me/sessions/revoke-others", mutation(retained.headers, {}));
  await recovery;
  // Then: the closed authorization channel cannot become editable offline.
  expect(response.status).toBe(200);
  expect(removed.document.getSnapshot().persistence).toMatchObject({ kind: "recovery", localText: before });
  expect(await removed.document.flush(AbortSignal.timeout(10000)).then(
    () => "resolved", error => error instanceof TransportError ? error.code : "unexpected",
  )).toBe("RECOVERY_REQUIRED");
});
