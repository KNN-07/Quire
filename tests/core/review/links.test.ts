import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, resourceVersionTag } from "@quire/contracts";
import * as Y from "yjs";
import { reviewFixture, peer, sourceDoc, mutation } from "./harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

test("closes a subscribed editor-link client immediately when its actual share token is revoked", async () => {
  // Given: a live, authenticated Editor link and two actual subscribed websocket clients.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const guest = await fixture.login("outsider@quire.local");
  (await fixture.runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true })]));
  const scope = { projectId: ids.project, branch: "main" };
  const linkInput = mutation(owner.headers, { role: "editor", expectedVersion: 0 });
  const linkResponse = await fixture.request(`/api/projects/${ids.project}/link`, { ...linkInput,
    method: "PUT", headers: { ...Object.fromEntries(new Headers(linkInput.headers)), "if-match": resourceVersionTag(0) } });
  const link = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await linkResponse.json()).data.urlOnce;
  const token = new URL(link).searchParams.get("share");
  if (!token) throw new TypeError("Expected one-time share credential");
  await using observer = await peer(fixture.url, scope, owner.headers);
  await using linked = await peer(fixture.url, scope, { ...guest.headers, "x-project-token": token });
  const source = (await fixture.service.loadDocument(scope, ids.mainFile));
  const subscriptions = [observer.next(message => message.type === "update"), linked.next(message => message.type === "update")];
  observer.send({ type: "sync", fileId: ids.mainFile, epoch: 0, stateVectorBase64: source.vector });
  linked.send({ type: "sync", fileId: ids.mainFile, epoch: 0, stateVectorBase64: source.vector });
  await Promise.all(subscriptions);
  const doc = sourceDoc(source.state);
  doc.getText("source").insert(doc.getText("source").length, "\nEDITOR LINK");
  const ack = linked.next(message => message.type === "ack");
  linked.send({ type: "update", fileId: ids.mainFile, epoch: 0, clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
    updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") });
  await ack;
  const closed = new Promise<CloseEvent>(resolve => linked.socket.addEventListener("close", resolve, { once: true }));
  // When: the owner revokes the current persisted token through the real HTTP endpoint.
  const version = (await fixture.service.getProject(ids.project)).version;
  const revoke = mutation(owner.headers, { role: "off", expectedVersion: version });
  const response = await fixture.request(`/api/projects/${ids.project}/link`, { ...revoke,
    method: "PUT", headers: { ...Object.fromEntries(new Headers(revoke.headers)), "if-match": resourceVersionTag(version) } });
  // Then: the live socket closes and its transient membership cannot authorize another request.
  expect(response.status).toBe(200);
  expect((await closed).code).toBe(1008);
  expect((await fixture.runtime.db.get("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.outsider]))).toBeNull();
  const denied = await fixture.request(`/api/projects/${ids.project}/threads?branch=main`,
    { headers: { ...guest.headers, "x-project-token": token } });
  expect(denied.status).not.toBe(200);
  expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toContain("EDITOR LINK");
  doc.destroy();
});

test("allows Viewer-link review reads but denies chat and comment mutations", async () => {
  // Given: an actual Viewer token, not a fabricated named membership.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const guest = await fixture.login("outsider@quire.local");
  (await fixture.runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true })]));
  const scope = { projectId: ids.project, branch: "main" };
  const input = mutation(owner.headers, { role: "viewer", expectedVersion: 0 });
  const link = await fixture.request(`/api/projects/${ids.project}/link`, { ...input, method: "PUT",
    headers: { ...Object.fromEntries(new Headers(input.headers)), "if-match": resourceVersionTag(0) } });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await link.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Expected Viewer credential");
  const headers = { ...guest.headers, "x-project-token": token };
  // When: the same token is used for reads, comments and chat, including an anonymous read.
  const read = await fixture.request(`/api/projects/${ids.project}/threads?branch=main`, { headers });
  const anonymous = await fixture.request(`/api/projects/${ids.project}/history?branch=main`, { headers: { "x-project-token": token } });
  const comment = await fixture.request(`/api/projects/${ids.project}/threads`, mutation(headers, { scope, body: "denied", expectedVersion: 0 }));
  const chat = await fixture.request(`/api/projects/${ids.project}/chat`, mutation(headers, { scope, body: "denied", expectedVersion: 0 }));
  // Then: Viewer links disclose authorized reads only, with no chat/comment authority.
  expect(read.status).toBe(200);
  expect(anonymous.status).toBe(200);
  expect(comment.status).not.toBe(200);
  expect(chat.status).not.toBe(200);
});
