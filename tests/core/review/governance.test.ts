import { expect, test } from "bun:test";
import { z } from "zod";
import { ThreadSchema, IdSchema } from "@quire/contracts";
import { flushNotificationDigests } from "../../../services/accounts/governance";
import { reviewFixture, mutation, peer } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("produces authorized mention and reply notifications with preferences, dedupe and clock-controlled digest delivery", async () => {
  // Given: actual governance preferences and three different review recipient choices.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const mai = await fixture.login("mai@quire.local");
  const sam = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const preference = await fixture.request("/api/me/notification-preferences", {
    method: "PATCH", headers: mai.headers, body: JSON.stringify({ events: { mention: false }, channels: ["in-app", "email"],
      projectOverrides: { [ids.project]: { mention: true } }, expectedVersion: 0 }),
  });
  expect(preference.status).toBe(200);
  const activity = await fixture.request("/api/me/notification-preferences", {
    method: "PATCH", headers: sam.headers, body: JSON.stringify({ events: { activity: true }, channels: ["in-app", "email"],
      projectOverrides: {}, expectedVersion: 0 }),
  });
  expect(activity.status).toBe(200);
  const input = mutation(owner.headers, { scope, body: "@Mai Tran and @outsider@quire.local", expectedVersion: 0 });
  const created = await fixture.request(`/api/projects/${ids.project}/threads`, input);
  const thread = z.object({ data: ThreadSchema }).parse(await created.json()).data;
  const replay = await fixture.request(`/api/projects/${ids.project}/threads`, input);
  expect(replay.status).toBe(200);
  const reply = await fixture.request(`/api/projects/${ids.project}/threads/${thread.id}/replies`,
    mutation(sam.headers, { body: "A reply to the author", expectedVersion: 0 }));
  expect(reply.status).toBe(200);
  const notifications = z.array(z.object({ user_id: IdSchema, kind: z.string() })).parse(
    fixture.runtime.db.query("SELECT user_id,kind FROM notifications ORDER BY user_id,kind").all());
  expect(notifications).toEqual([
    { user_id: ids.kien, kind: "reply" }, { user_id: ids.mai, kind: "mention" }, { user_id: ids.sam, kind: "activity" },
  ]);
  const context = { ...fixture.runtime, routes: fixture.runtime.routes.forLane("K") };
  expect(flushNotificationDigests(context)).toBe(0);
  fixture.runtime.db.query("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(ids.project, ids.sam);
  // When: the injected clock reaches the ten-minute bucket after a queued recipient loses access.
  fixture.setTime("2026-10-26T12:10:00.000Z");
  const delivered = flushNotificationDigests(context);
  // Then: one real local digest per still-authorized recipient is emitted, with no outsider or revoked-user mail.
  expect(delivered).toBe(2);
  expect(flushNotificationDigests(context)).toBe(0);
  const mail = z.array(z.object({ recipient: z.string() })).parse(fixture.runtime.db.query("SELECT recipient FROM mail_outbox ORDER BY recipient").all());
  expect(mail).toEqual([{ recipient: "kien@quire.local" }, { recipient: "mai@quire.local" }]);
});

test("enforces actual editor closure on an established socket and direct review writes while keeping reads available", async () => {
  // Given: a writable authenticated connection established before administrative closure.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const source = fixture.service.loadDocument(scope, ids.mainFile);
  await using client = await peer(fixture.url, scope, owner.headers);
  const closure = await fixture.request("/api/admin/editor-state",
    mutation(operator.headers, { closed: true, message: "Maintenance", expectedVersion: 0 }));
  expect(closure.status).toBe(200);
  const error = client.next(message => message.type === "error");
  // When: an existing client and direct HTTP mutation both attempt a write.
  client.send({ type: "update", fileId: ids.mainFile, epoch: 0, clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
    updateBase64: source.state });
  const comment = await fixture.request(`/api/projects/${ids.project}/threads`,
    mutation(owner.headers, { scope, body: "Blocked during closure", expectedVersion: 0 }));
  const read = await fixture.request(`/api/projects/${ids.project}/threads?branch=main`, { headers: owner.headers });
  const chat = await fixture.request(`/api/projects/${ids.project}/chat?branch=main`, { headers: owner.headers });
  // Then: closure denies both writes without closing legitimate read access or changing source.
  expect(await error).toMatchObject({ type: "error", code: "EDITOR_CLOSED" });
  expect(comment.status).toBe(503);
  expect(read.status).toBe(200);
  expect(chat.status).toBe(200);
  expect(fixture.service.loadDocument(scope, ids.mainFile)).toEqual(source);
});
