import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, resourceVersionTag } from "@quire/contracts";
import { reviewFixture, peer, mutation } from "./harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

test("subscribes an anonymous Viewer without inventing an identity and closes it on real token revocation", async () => {
  // Given: one authenticated observer and a genuine anonymous Viewer credential.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  fixture.runtime.db.query("UPDATE organizations SET policy_json=?")
    .run(JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true }));
  const scope = { projectId: ids.project, branch: "main" };
  const input = mutation(owner.headers, { role: "viewer", expectedVersion: 0 });
  const response = await fixture.request(`/api/projects/${ids.project}/link`, { ...input, method: "PUT",
    headers: { ...Object.fromEntries(new Headers(input.headers)), "if-match": resourceVersionTag(0) } });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await response.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Expected anonymous Viewer token");
  const sessions = fixture.runtime.db.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n;
  await using observer = await peer(fixture.url, scope, owner.headers);
  await using anonymous = await peer(fixture.url, scope, { "x-project-token": token });
  await using attacker = await peer(fixture.url, scope, { "x-project-token": token });
  const source = fixture.service.loadDocument(scope, ids.mainFile);
  const synced = [anonymous.next(message => message.type === "update"), observer.next(message => message.type === "update")];
  anonymous.send({ type: "sync", fileId: ids.mainFile, epoch: 0, stateVectorBase64: source.vector });
  observer.send({ type: "sync", fileId: ids.mainFile, epoch: 0, stateVectorBase64: source.vector });
  await Promise.all(synced);
  const denied = attacker.next(message => message.type === "error");
  attacker.send({ type: "update", fileId: ids.mainFile, epoch: 0, clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
    updateBase64: source.state });
  expect(await denied).toMatchObject({ type: "error", code: "FORBIDDEN" });
  const closed = new Promise<CloseEvent>(resolve => anonymous.socket.addEventListener("close", resolve, { once: true }));
  // When: the owner revokes the token through its actual checked HTTP mutation.
  const version = fixture.service.getProject(ids.project).version;
  const revoke = mutation(owner.headers, { role: "off", expectedVersion: version });
  const revoked = await fixture.request(`/api/projects/${ids.project}/link`, { ...revoke, method: "PUT",
    headers: { ...Object.fromEntries(new Headers(revoke.headers)), "if-match": resourceVersionTag(version) } });
  // Then: the anonymous transport loses read access, source remains unchanged and no account/session was fabricated.
  expect(revoked.status).toBe(200);
  expect((await closed).code).toBe(1008);
  expect(observer.socket.readyState).toBe(WebSocket.OPEN);
  expect(fixture.service.loadDocument(scope, ids.mainFile)).toEqual(source);
  expect(fixture.runtime.db.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n).toBe(sessions);
});
