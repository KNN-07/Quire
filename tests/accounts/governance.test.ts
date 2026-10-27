import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, NotificationPreferencesSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../fixtures/foundation";
import { governanceFixture, data } from "./governance/harness";
import { enqueueNotification, flushNotificationDigests } from "../../services/accounts/governance";

test("honors event and project preferences when a producer emits mentions and replies", async () => {
  // Given: email/in-app preferences with a project-specific mention deny.
  await using app = await governanceFixture();
  const user = await app.login("mai@quire.local");
  const preferences = await user.write("/api/me/notification-preferences", {
    events: { reply: true, mention: true }, channels: ["in-app", "email"],
    projectOverrides: { [ids.project]: { mention: false } }, expectedVersion: 0,
  }, { method: "PATCH" });
  expect(preferences.status).toBe(200);
  // When: a transaction emits both event kinds for that project.
  app.runtime.uow.local(() => {
    for (const kind of ["mention", "reply"]) enqueueNotification(app.context, {
      userId: ids.mai, kind, resourceId: ids.project, projectId: ids.project,
      dedupeKey: `event:${kind}`, mail: { subject: kind, body: "Authorized project event" },
    });
  });
  // Then: only the allowed reply appears in both transactional delivery channels.
  const notifications = await data(await user.get("/api/notifications"), z.object({
    items: z.array(z.object({ kind: z.string() })),
  }));
  expect(notifications.items.map((item) => item.kind)).toEqual(["reply"]);
  expect(z.object({ total: z.number() }).parse(app.runtime.db.query(
    "SELECT count(*) AS total FROM mail_outbox WHERE recipient='mai@quire.local'").get()).total).toBe(1);
  expect((await data(await user.get("/api/me/notification-preferences"), NotificationPreferencesSchema)).version).toBe(1);
});

test("deduplicates notification and mail atomically when a producer retries", async () => {
  // Given: a stable producer event key.
  await using app = await governanceFixture();
  const input = { userId: ids.mai, kind: "reply", resourceId: ids.project, dedupeKey: "comment:one",
    mail: { subject: "Reply", body: "An authorized reply" } };
  // When: delivery is retried inside independent transactions.
  const deliveries = [0, 1].map(() => app.runtime.uow.local(() => enqueueNotification(app.context, input)));
  // Then: exactly one durable notification and one outbox item exist.
  expect(deliveries.filter((id) => id !== null)).toHaveLength(1);
  expect(z.object({ total: z.number() }).parse(app.runtime.db.query("SELECT count(*) AS total FROM notifications").get()).total).toBe(1);
  expect(z.object({ total: z.number() }).parse(app.runtime.db.query("SELECT count(*) AS total FROM mail_outbox").get()).total).toBe(1);
});

test("rolls back the outbox and receipt when the producer transaction fails", async () => {
  // Given: an actual synchronous unit of work with a notification.
  await using app = await governanceFixture();
  // When: the business mutation fails after enqueueing.
  expect(() => app.runtime.uow.local(() => {
    enqueueNotification(app.context, { userId: ids.mai, kind: "reply", resourceId: ids.project, dedupeKey: "rolled-back",
      mail: { subject: "Reply", body: "Never delivered" } });
    throw new TypeError("business mutation failed");
  })).toThrow(TypeError);
  // Then: no notification, mail, event, or dedupe receipt escapes rollback.
  for (const table of ["notifications", "mail_outbox", "governance_notification_receipts", "events"]) {
    expect(z.object({ total: z.number() }).parse(app.runtime.db.query(`SELECT count(*) AS total FROM ${table}`).get()).total).toBe(0);
  }
});

test("flushes a digest exactly at its injected clock boundary and never twice", async () => {
  // Given: two replies due at UTC midnight.
  await using app = await governanceFixture();
  app.runtime.uow.local(() => {
    for (const key of ["one", "two"]) enqueueNotification(app.context, { userId: ids.mai, kind: "reply",
      resourceId: ids.project, projectId: ids.project, dedupeKey: key,
      mail: { subject: "Reply", body: key, digestAt: "2026-10-27T00:00:00.000Z" } });
  });
  expect(flushNotificationDigests(app.context)).toBe(0);
  app.setTime("2026-10-27T00:00:00.000Z");
  // When: the scheduler runs at the exact due instant.
  const delivered = flushNotificationDigests(app.context);
  // Then: one actual combined mail is created and later runs are idempotent.
  expect(delivered).toBe(1);
  expect(flushNotificationDigests(app.context)).toBe(0);
  expect(z.object({ body: z.string() }).parse(app.runtime.db.query("SELECT body FROM mail_outbox").get()).body).toContain("one");
});

test("does not let another account read or acknowledge a private notification", async () => {
  // Given: a private notification for Mai.
  await using app = await governanceFixture();
  const user = await app.login();
  const id = app.runtime.uow.local(() => enqueueNotification(app.context, {
    userId: ids.mai, kind: "mention", resourceId: ids.project, dedupeKey: "private", mail: { subject: "Mention", body: "Private" },
  }));
  if (!id) throw new TypeError("Notification missing");
  // When: Kien tries to acknowledge Mai's notification.
  const response = await user.write(`/api/notifications/${id}/read`, { expectedVersion: 0 });
  // Then: it is absent from his listing and cannot be modified.
  expect(response.status).toBe(404);
  expect((await data(await user.get("/api/notifications"), z.object({ items: z.array(z.object({ id: IdSchema })) }))).items).toEqual([]);
});
test("drops deferred project mail when the recipient loses project access before dispatch", async () => {
  // Given: a deferred reply followed by removal of the recipient's project ACL.
  await using app = await governanceFixture();
  app.runtime.uow.local(() => enqueueNotification(app.context, { userId: ids.mai, kind: "reply",
    resourceId: ids.project, projectId: ids.project, dedupeKey: "revoked-recipient",
    mail: { subject: "Reply", body: "Private reply", digestAt: "2026-10-27T00:00:00.000Z" } }));
  app.runtime.db.query("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(ids.project, ids.mai);
  app.setTime("2026-10-27T00:00:00.000Z");
  // When: the actual deferred-mail flush runs.
  const delivered = flushNotificationDigests(app.context);
  // Then: no stale private project content is mailed.
  expect(delivered).toBe(0);
  expect(app.runtime.db.query("SELECT id FROM mail_outbox").get()).toBeNull();
});
test("purges deferred notification content when the real identity workflow deletes the account", async () => {
  // Given: an independent account with deferred private notification content.
  await using app = await governanceFixture();
  const user = await app.login("mai@quire.local");
  app.runtime.uow.local(() => enqueueNotification(app.context, { userId: ids.mai, kind: "reply",
    resourceId: ids.project, projectId: ids.project, dedupeKey: "delete-recipient",
    mail: { subject: "Reply", body: "Private retained content", digestAt: "2026-10-27T00:00:00.000Z" } }));
  // When: the user completes real password-confirmed account deletion.
  const response = await user.write("/api/me", { confirmation: "mai@quire.local",
    password: "governance-test-password-2026", expectedVersion: 0 }, { method: "DELETE" });
  // Then: governance's persistence seam removes deferred private content atomically.
  expect(response.status).toBe(200);
  expect(app.runtime.db.query("SELECT id FROM governance_digest_items WHERE user_id=?").get(ids.mai)).toBeNull();
});
