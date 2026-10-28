import { expect, test } from "bun:test";
import { z } from "zod";
import { resourceVersionTag } from "@quire/contracts";
import { reviewFixture, peer, mutation } from "./harness";
import type { SourceDocument } from "../../../services/core/base";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

async function events(fixture: Awaited<ReturnType<typeof reviewFixture>>, headers: Record<string, string>) {
  const response = await fixture.request("/api/events?after=0", { headers });
  const body = response.body;
  if (!body) throw new TypeError("Expected authenticated SSE stream");
  const reader = body.getReader();
  async function through(marker: string): Promise<string> {
    let text = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) throw new TypeError("Stream closed before its authorized event");
      text += new TextDecoder().decode(part.value);
      if (text.includes(marker)) return text;
    }
  }
  await through(": ready\n\n");
  return {
    through,
    async ended(): Promise<string> {
      let text = "";
      for (;;) {
        const part = await reader.read();
        if (part.done) return text;
        text += new TextDecoder().decode(part.value);
      }
    },
    async [Symbol.asyncDispose]() { await reader.cancel(); },
  };
}
async function subscribe(client: Awaited<ReturnType<typeof peer>>, document: SourceDocument): Promise<void> {
  const synced = client.next(message => message.type === "update");
  client.send({ type: "sync", fileId: ids.mainFile, epoch: document.epoch, stateVectorBase64: document.vector });
  await synced;
}

test("revoke-others closes only removed authenticated sessions and keeps retained and unrelated WS/SSE live", async () => {
  // Given: separate actual sessions for one user and another project collaborator.
  await using fixture = await reviewFixture();
  const retained = await fixture.login();
  const removed = await fixture.login();
  const unrelated = await fixture.login("mai@quire.local");
  const removedPrincipal = await fixture.runtime.services.get("identity").require(new Request(fixture.url, { headers: removed.headers }));
  const scope = { projectId: ids.project, branch: "main" };
  const source = (await fixture.service.loadDocument(scope, ids.mainFile));
  await using keptSocket = await peer(fixture.url, scope, retained.headers);
  await using removedSocket = await peer(fixture.url, scope, removed.headers);
  await using otherSocket = await peer(fixture.url, scope, unrelated.headers);
  await Promise.all([subscribe(keptSocket, source), subscribe(removedSocket, source), subscribe(otherSocket, source)]);
  await using keptEvents = await events(fixture, retained.headers);
  await using removedEvents = await events(fixture, removed.headers);
  await using otherEvents = await events(fixture, unrelated.headers);
  const closed = new Promise<CloseEvent>(resolve => removedSocket.socket.addEventListener("close", resolve, { once: true }));
  const ended = removedEvents.ended();
  // When: the actual identity endpoint commits removal of every session except its caller.
  const response = await fixture.request("/api/me/sessions/revoke-others", mutation(retained.headers, {}));
  expect(response.status).toBe(200);
  expect((await closed).code).toBe(1008);
  expect(await ended).not.toContain("session.revoked");
  const retainedUpdate = keptSocket.next(message => message.type === "update");
  const otherUpdate = otherSocket.next(message => message.type === "update");
  const checkpoint = await fixture.service.snapshot(retained.user.id, scope, (await fixture.service.getBranch(scope)).revision);
  const [retainedStream, otherStream] = await Promise.all([keptEvents.through(checkpoint.id), otherEvents.through(checkpoint.id)]);
  await Promise.all([retainedUpdate, otherUpdate]);
  // Then: committed targeting is exact, the retained session works, and the control event never leaks.
  expect((await fixture.request("/api/me", { headers: retained.headers })).status).toBe(200);
  expect((await fixture.request("/api/me", { headers: removed.headers })).status).toBe(401);
  expect(retainedStream).not.toContain("session.revoked");
  expect(otherStream).not.toContain("session.revoked");
  expect(keptSocket.socket.readyState).toBe(WebSocket.OPEN);
  expect(otherSocket.socket.readyState).toBe(WebSocket.OPEN);
  const revoked = (await fixture.runtime.events.read(0, { limit: 200 })).filter(event => event.topic === "session.revoked");
  expect(revoked.map(event => ({ aggregateId: event.aggregateId, ...event.payload }))).toEqual([
    { aggregateId: ids.kien, userId: ids.kien, sessionId: removedPrincipal.sessionId },
  ]);
});

test("wildcard revocation closes existing matching WS/SSE but not later sessions or unrelated readers", async () => {
  // Given: two authenticated transports for one account and an unrelated active collaborator.
  await using fixture = await reviewFixture();
  const first = await fixture.login();
  const second = await fixture.login();
  const unrelated = await fixture.login("mai@quire.local");
  const operator = await fixture.login("operator@quire.local");
  (await fixture.runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true })]));
  const grant = mutation(first.headers, { role: "viewer", expectedVersion: 0 });
  const shared = await fixture.request(`/api/projects/${ids.project}/link`, { ...grant, method: "PUT",
    headers: { ...Object.fromEntries(new Headers(grant.headers)), "if-match": resourceVersionTag(0) } });
  const shareUrl = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await shared.json()).data.urlOnce;
  const token = new URL(shareUrl).searchParams.get("share");
  if (!token) throw new TypeError("Expected actual anonymous Viewer credential");
  const anonymousHeaders = { "x-project-token": token };
  const scope = { projectId: ids.project, branch: "main" };
  const source = (await fixture.service.loadDocument(scope, ids.mainFile));
  await using firstSocket = await peer(fixture.url, scope, first.headers);
  await using secondSocket = await peer(fixture.url, scope, second.headers);
  await using otherSocket = await peer(fixture.url, scope, unrelated.headers);
  await using anonymousSocket = await peer(fixture.url, scope, anonymousHeaders);
  await Promise.all([subscribe(firstSocket, source), subscribe(secondSocket, source),
    subscribe(otherSocket, source), subscribe(anonymousSocket, source)]);
  await using firstEvents = await events(fixture, first.headers);
  await using secondEvents = await events(fixture, second.headers);
  await using otherEvents = await events(fixture, unrelated.headers);
  await using anonymousEvents = await events(fixture, anonymousHeaders);
  const closed = [firstSocket, secondSocket].map(client =>
    new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve, { once: true })));
  const ended = [firstEvents.ended(), secondEvents.ended()];
  // When: the real governance endpoint deletes all target sessions and commits sessionId:null.
  const response = await fixture.request(`/api/admin/users/${ids.kien}/revoke-sessions`,
    mutation(operator.headers, { expectedVersion: 0 }));
  expect(response.status).toBe(200);
  expect((await Promise.all(closed)).map(event => event.code)).toEqual([1008, 1008]);
  expect((await Promise.all(ended)).every(text => !text.includes("session.revoked"))).toBe(true);
  const otherUpdate = otherSocket.next(message => message.type === "update");
  const anonymousUpdate = anonymousSocket.next(message => message.type === "update");
  const checkpoint = await fixture.service.snapshot(unrelated.user.id, scope, (await fixture.service.getBranch(scope)).revision);
  const [otherStream, anonymousStream] = await Promise.all([
    otherEvents.through(checkpoint.id), anonymousEvents.through(checkpoint.id),
  ]);
  await Promise.all([otherUpdate, anonymousUpdate]);
  // Then: wildcard matching is user-scoped, and unrelated subscribers still receive authorized project events only.
  expect((await fixture.request("/api/me", { headers: first.headers })).status).toBe(401);
  expect((await fixture.request("/api/me", { headers: second.headers })).status).toBe(401);
  expect((await fixture.request("/api/me", { headers: unrelated.headers })).status).toBe(200);
  expect(otherStream).not.toContain("session.revoked");
  expect(anonymousStream).not.toContain("session.revoked");
  expect(otherSocket.socket.readyState).toBe(WebSocket.OPEN);
  expect(anonymousSocket.socket.readyState).toBe(WebSocket.OPEN);
  const revoked = (await fixture.runtime.events.read(0, { limit: 200 })).filter(event => event.topic === "session.revoked");
  expect(revoked.map(event => ({ aggregateId: event.aggregateId, ...event.payload }))).toEqual([
    { aggregateId: ids.kien, userId: ids.kien, sessionId: null },
  ]);
  // A later login is valid even when the controlled clock has not advanced.
  const fresh = await fixture.login();
  await using freshSocket = await peer(fixture.url, scope, fresh.headers);
  await subscribe(freshSocket, source);
  await using freshEvents = await events(fixture, fresh.headers);
  const freshUpdate = freshSocket.next(message => message.type === "update");
  const freshCheckpoint = await fixture.service.snapshot(fresh.user.id, scope, (await fixture.service.getBranch(scope)).revision);
  const freshStream = await freshEvents.through(freshCheckpoint.id);
  await freshUpdate;
  expect((await fixture.request("/api/me", { headers: fresh.headers })).status).toBe(200);
  expect(freshSocket.socket.readyState).toBe(WebSocket.OPEN);
  expect(freshStream).not.toContain("session.revoked");
});
