import { expect, test } from "bun:test";
import * as Y from "yjs";
import { IdSchema } from "@quire/contracts";
import { reviewFixture, peer, sourceDoc } from "../core/review/harness";
import { fixtureIds as ids } from "../fixtures/foundation";

test("converges two subscribed editors with overlapping updates, durable duplicates and restart", async () => {
  // Given: two actual websocket clients subscribed to the same durable Yjs file.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const editor = await fixture.login("mai@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const baseline = fixture.service.loadDocument(scope, ids.mainFile);
  const first = sourceDoc(baseline.state);
  const second = sourceDoc(baseline.state);
  await using left = await peer(fixture.url, scope, owner.headers);
  await using right = await peer(fixture.url, scope, editor.headers);
  const leftSync = left.next(message => message.type === "update");
  const rightSync = right.next(message => message.type === "update");
  left.send({ type: "sync", fileId: ids.mainFile, epoch: baseline.epoch, stateVectorBase64: baseline.vector });
  right.send({ type: "sync", fileId: ids.mainFile, epoch: baseline.epoch, stateVectorBase64: baseline.vector });
  await Promise.all([leftSync, rightSync]);
  const presence = right.next(message => message.type === "presence");
  left.send({ type: "presence", fileId: ids.mainFile, cursor: "selected-range", name: "Spoofed name" });
  expect(await presence).toMatchObject({ type: "presence", userId: owner.user.id, name: owner.user.name, cursor: "selected-range" });
  const vector = Buffer.from(baseline.vector, "base64");
  const start = baseline.text.indexOf("\\begin{document}") + "\\begin{document}".length;
  first.getText("source").insert(start, "left😀");
  second.getText("source").insert(start, "right漢");
  const leftId = IdSchema.parse(crypto.randomUUID());
  const rightId = IdSchema.parse(crypto.randomUUID());
  const update = { type: "update", fileId: ids.mainFile, epoch: baseline.epoch,
    clientId: leftId, clientSeq: 1, updateBase64: Buffer.from(Y.encodeStateAsUpdate(first, vector)).toString("base64") } as const;
  const other = { ...update, clientId: rightId, updateBase64: Buffer.from(Y.encodeStateAsUpdate(second, vector)).toString("base64") };
  // When: overlapping offline edits arrive concurrently, followed by a byte-identical retry and restart.
  const leftAck = left.next(message => message.type === "ack");
  const rightAck = right.next(message => message.type === "ack");
  const leftConverged = left.next(message => message.type === "update" && message.revision === baseline.revision + 2);
  const rightConverged = right.next(message => message.type === "update" && message.revision === baseline.revision + 2);
  left.send(update); right.send(other);
  const [ack, , leftState, rightState] = await Promise.all([leftAck, rightAck, leftConverged, rightConverged]);
  const duplicate = left.next(message => message.type === "ack");
  left.send(update);
  expect(await duplicate).toEqual(ack);
  expect(fixture.service.getBranch(scope).revision).toBe(baseline.revision + 2);
  await fixture.restart();
  await using reconnected = await peer(fixture.url, scope, owner.headers);
  const replay = reconnected.next(message => message.type === "ack");
  reconnected.send(update);
  const replayAck = await replay;
  // Then: both subscribed clients and the restarted durable document contain exactly the merged edits.
  expect(replayAck).toEqual(ack);
  expect(leftState.type).toBe("update");
  expect(rightState).toEqual(leftState);
  if (leftState.type !== "update") throw new TypeError("Expected merged update");
  Y.applyUpdate(first, Buffer.from(leftState.updateBase64, "base64"));
  Y.applyUpdate(second, Buffer.from(leftState.updateBase64, "base64"));
  expect(first.getText("source").toJSON()).toBe(second.getText("source").toJSON());
  expect(fixture.service.loadDocument(scope, ids.mainFile).text).toBe(first.getText("source").toJSON());
  expect(first.getText("source").toJSON()).toContain("left😀");
  expect(first.getText("source").toJSON()).toContain("right漢");
  const reconnectVector = Y.encodeStateVector(first);
  first.getText("source").insert(first.getText("source").length, "\nOFFLINE RECONNECT");
  const resumed = reconnected.next(message => message.type === "ack" && message.clientSeq === 2);
  reconnected.send({ ...update, clientSeq: 2,
    updateBase64: Buffer.from(Y.encodeStateAsUpdate(first, reconnectVector)).toString("base64") });
  await resumed;
  expect(fixture.service.loadDocument(scope, ids.mainFile).text.match(/OFFLINE RECONNECT/g)).toHaveLength(1);
  first.destroy(); second.destroy();
});

test("rejects reviewer socket mutation and closes a live editor transport after access revocation", async () => {
  // Given: an editor and reviewer connected and subscribed over real sockets.
  await using fixture = await reviewFixture();
  const editor = await fixture.login("mai@quire.local");
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const baseline = fixture.service.loadDocument(scope, ids.mainFile);
  await using writable = await peer(fixture.url, scope, editor.headers);
  await using readonly = await peer(fixture.url, scope, reviewer.headers);
  const synced = writable.next(message => message.type === "update");
  writable.send({ type: "sync", fileId: ids.mainFile, epoch: baseline.epoch, stateVectorBase64: baseline.vector });
  await synced;
  const denied = readonly.next(message => message.type === "error");
  const doc = sourceDoc(baseline.state);
  doc.getText("source").insert(doc.getText("source").length, "forbidden");
  const update = { type: "update", fileId: ids.mainFile, epoch: baseline.epoch,
    clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
    updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") } as const;
  // When: the reviewer writes and the editor loses persisted membership.
  readonly.send(update);
  const error = await denied;
  const closed = new Promise<CloseEvent>(resolve => writable.socket.addEventListener("close", resolve, { once: true }));
  fixture.runtime.uow.local(tx => {
    tx.query("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(ids.project, ids.mai);
    fixture.runtime.events.append(tx, { topic: "access.changed", aggregateId: ids.project,
      payload: { resourceId: ids.project, version: 1 } });
  });
  fixture.runtime.events.dispatch();
  // Then: revocation is event-driven, and neither unauthorized update changed durable source.
  expect(error).toMatchObject({ type: "error", code: "FORBIDDEN" });
  expect((await closed).code).toBe(1008);
  expect(fixture.service.loadDocument(scope, ids.mainFile).text).toBe(baseline.text);
  doc.destroy();
});

test("replays only authorized SSE project events and closes streams on session revocation", async () => {
  // Given: an owner subscribed through the actual HTTP SSE endpoint.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const controller = new AbortController();
  const response = await fixture.request("/api/events?after=0", { headers: owner.headers, signal: controller.signal });
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Expected event stream");
  const outsiderAbort = new AbortController();
  const denied = await fixture.request("/api/events?after=0", { headers: outsider.headers, signal: outsiderAbort.signal });
  const outsiderReader = denied.body?.getReader();
  if (!outsiderReader) throw new TypeError("Expected isolated event stream");
  // When: a real source checkpoint is committed, then the owner's session is revoked.
  await fixture.service.snapshot(owner.user.id, { projectId: ids.project, branch: "main" }, 0);
  let text = "";
  while (!text.includes("history.created")) {
    const chunk = await reader.read();
    if (chunk.done) throw new TypeError("Stream ended before checkpoint");
    text += new TextDecoder().decode(chunk.value);
  }
  let other = "";
  while (!other.includes(": ready")) {
    const chunk = await outsiderReader.read();
    if (chunk.done) break;
    other += new TextDecoder().decode(chunk.value);
  }
  const logout = await fixture.request("/api/auth/logout", { method: "POST", headers: owner.headers, body: "{}" });
  // Then: replay contains the owner's checkpoint, never leaks it to an outsider, and revocation ends the stream.
  expect(text).toContain(ids.project);
  expect(other).not.toContain(ids.project);
  expect(logout.status).toBe(200);
  let done = false;
  while (!done) done = (await reader.read()).done;
  expect(done).toBe(true);
  controller.abort(); outsiderAbort.abort();
  await reader.cancel(); await outsiderReader.cancel();
});
