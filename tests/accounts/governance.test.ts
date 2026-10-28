import { rejects } from "node:assert/strict";
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
  await app.runtime.uow.run(async (tx) => {
    for (const kind of ["mention", "reply"]) await enqueueNotification({ ...app.context, db: tx }, {
      userId: ids.mai, kind, resourceId: ids.project, projectId: ids.project,
      dedupeKey: `event:${kind}`, mail: { subject: kind, body: "Authorized project event" },
    });
  });
  // Then: only the allowed reply appears in both transactional delivery channels.
  const notifications = await data(await user.get("/api/notifications"), z.object({
    items: z.array(z.object({ kind: z.string() })),
  }));
  expect(notifications.items.map((item) => item.kind)).toEqual(["reply"]);
  expect(z.object({ total: z.number() }).parse((await app.runtime.db.get("SELECT count(*) AS total FROM mail_outbox WHERE recipient='mai@quire.local'", []))).total).toBe(1);
  expect((await data(await user.get("/api/me/notification-preferences"), NotificationPreferencesSchema)).version).toBe(1);
});

test("deduplicates notification and mail atomically when a producer retries", async () => {
  // Given: a stable producer event key.
  await using app = await governanceFixture();
  const input = { userId: ids.mai, kind: "reply", resourceId: ids.project, dedupeKey: "comment:one",
    mail: { subject: "Reply", body: "An authorized reply" } };
  // When: delivery is retried inside independent transactions.
  const deliveries = (await Promise.all([0, 1].map(async () => await app.runtime.uow.run(async (tx) => (await enqueueNotification({ ...app.context, db: tx }, input))))));
  // Then: exactly one durable notification and one outbox item exist.
  expect(deliveries.filter((id) => id !== null)).toHaveLength(1);
  expect(z.object({ total: z.number() }).parse((await app.runtime.db.get("SELECT count(*) AS total FROM notifications", []))).total).toBe(1);
  expect(z.object({ total: z.number() }).parse((await app.runtime.db.get("SELECT count(*) AS total FROM mail_outbox", []))).total).toBe(1);
});

test("rolls back the outbox and receipt when the producer transaction fails", async () => {
  // Given: an actual synchronous unit of work with a notification.
  await using app = await governanceFixture();
  // When: the business mutation fails after enqueueing.
  await rejects(app.runtime.uow.run(async (tx) => {
    await enqueueNotification({ ...app.context, db: tx }, { userId: ids.mai, kind: "reply", resourceId: ids.project, dedupeKey: "rolled-back",
      mail: { subject: "Reply", body: "Never delivered" } });
    throw new TypeError("business mutation failed");
  }), TypeError);
  // Then: no notification, mail, event, or dedupe receipt escapes rollback.
  for (const table of ["notifications", "mail_outbox", "governance_notification_receipts", "events"]) {
    expect(z.object({ total: z.number() }).parse((await app.runtime.db.get(`SELECT count(*) AS total FROM ${table}`, []))).total).toBe(0);
  }
});

test("flushes a digest exactly at its injected clock boundary and never twice", async () => {
  // Given: two replies due at UTC midnight.
  await using app = await governanceFixture();
  await app.runtime.uow.run(async (tx) => {
    for (const key of ["one", "two"]) await enqueueNotification({ ...app.context, db: tx }, { userId: ids.mai, kind: "reply",
      resourceId: ids.project, projectId: ids.project, dedupeKey: key,
      mail: { subject: "Reply", body: key, digestAt: "2026-10-27T00:00:00.000Z" } });
  });
  expect((await flushNotificationDigests(app.context))).toBe(0);
  app.setTime("2026-10-27T00:00:00.000Z");
  // When: the scheduler runs at the exact due instant.
  const delivered = (await flushNotificationDigests(app.context));
  // Then: one actual combined mail is created and later runs are idempotent.
  expect(delivered).toBe(1);
  expect((await flushNotificationDigests(app.context))).toBe(0);
  expect(z.object({ body: z.string() }).parse((await app.runtime.db.get("SELECT body FROM mail_outbox", []))).body).toContain("one");
});

test("does not let another account read or acknowledge a private notification", async () => {
  // Given: a private notification for Mai.
  await using app = await governanceFixture();
  const user = await app.login();
  const id = await app.runtime.uow.run(async (tx) => (await enqueueNotification({ ...app.context, db: tx }, {
    userId: ids.mai, kind: "mention", resourceId: ids.project, dedupeKey: "private", mail: { subject: "Mention", body: "Private" },
  })));
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
  await app.runtime.uow.run(async (tx) => (await enqueueNotification({ ...app.context, db: tx }, { userId: ids.mai, kind: "reply",
    resourceId: ids.project, projectId: ids.project, dedupeKey: "revoked-recipient",
    mail: { subject: "Reply", body: "Private reply", digestAt: "2026-10-27T00:00:00.000Z" } })));
  await app.runtime.db.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.mai]);
  app.setTime("2026-10-27T00:00:00.000Z");
  // When: the actual deferred-mail flush runs.
  const delivered = (await flushNotificationDigests(app.context));
  // Then: no stale private project content is mailed.
  expect(delivered).toBe(0);
  expect((await app.runtime.db.get("SELECT id FROM mail_outbox", []))).toBeNull();
});
test("purges deferred notification content when the real identity workflow deletes the account", async () => {
  // Given: an independent account with deferred private notification content.
  await using app = await governanceFixture();
  const user = await app.login("mai@quire.local");
  await app.runtime.uow.run(async (tx) => (await enqueueNotification({ ...app.context, db: tx }, { userId: ids.mai, kind: "reply",
    resourceId: ids.project, projectId: ids.project, dedupeKey: "delete-recipient",
    mail: { subject: "Reply", body: "Private retained content", digestAt: "2026-10-27T00:00:00.000Z" } })));
  // When: the user completes real password-confirmed account deletion.
  const response = await user.write("/api/me", { confirmation: "mai@quire.local",
    password: "governance-test-password-2026", expectedVersion: 0 }, { method: "DELETE" });
  // Then: governance's persistence seam removes deferred private content atomically.
  expect(response.status).toBe(200);
  expect((await app.runtime.db.get("SELECT id FROM governance_digest_items WHERE user_id=?", [ids.mai]))).toBeNull();
});
