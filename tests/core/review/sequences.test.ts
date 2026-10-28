import { expect, test } from "bun:test";
import * as Y from "yjs";
import { IdSchema } from "@quire/contracts";
import { reviewFixture, peer, sourceDoc } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("refuses different bytes for an acknowledged client sequence", async () => {
  // Given: a real editor whose first source update was durably acknowledged.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const source = (await fixture.service.loadDocument(scope, ids.mainFile));
  const doc = sourceDoc(source.state);
  doc.getText("source").insert(doc.getText("source").length, "\nFIRST");
  await using client = await peer(fixture.url, scope, owner.headers);
  const original = { type: "update", fileId: ids.mainFile, epoch: 0, clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
    updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") } as const;
  const first = client.next(message => message.type === "ack");
  client.send(original);
  await first;
  const saved = (await fixture.service.loadDocument(scope, ids.mainFile));
  doc.getText("source").insert(doc.getText("source").length, "\nCHANGED DUPLICATE");
  const error = client.next(message => message.type === "error");
  // When: an acknowledged sequence is reused with different Yjs bytes.
  client.send({ ...original, updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") });
  // Then: the stored acknowledgement cannot be rebound to different source.
  expect(await error).toMatchObject({ type: "error", code: "SEQUENCE_CONFLICT" });
  expect((await fixture.service.loadDocument(scope, ids.mainFile))).toEqual(saved);
  doc.destroy();
});

test("rejects sequence gaps before acknowledgement and accepts the missing ordered retry", async () => {
  // Given: a subscribed editor with a new client sequence namespace.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const source = (await fixture.service.loadDocument(scope, ids.mainFile));
  const doc = sourceDoc(source.state);
  doc.getText("source").insert(doc.getText("source").length, "\nOFFLINE");
  await using client = await peer(fixture.url, scope, owner.headers);
  const message = { type: "update", fileId: ids.mainFile, epoch: 0, clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 2,
    updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") } as const;
  const error = client.next(event => event.type === "error");
  // When: sequence two arrives before sequence one and the client then resends in order.
  client.send(message);
  expect(await error).toMatchObject({ type: "error", code: "SEQUENCE_GAP" });
  expect((await fixture.service.getBranch(scope)).revision).toBe(0);
  const ack = client.next(event => event.type === "ack");
  client.send({ ...message, clientSeq: 1 });
  await ack;
  const second = client.next(event => event.type === "ack" && event.clientSeq === 2);
  client.send(message);
  await second;
  // Then: missing sequences are explicit, while repeated Yjs updates converge without duplicated text.
  expect((await fixture.service.loadDocument(scope, ids.mainFile)).text.match(/OFFLINE/g)).toHaveLength(1);
  expect((await fixture.service.getBranch(scope)).revision).toBe(2);
  doc.destroy();
});
