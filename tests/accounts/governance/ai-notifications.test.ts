import { expect, test } from "bun:test";
import { OrganizationSchema } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("organization AI changes notify active members once and respect delivery preferences", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  for (const userId of [ids.mai, ids.sam, ids.alex]) {
    await app.runtime.db.run(`INSERT INTO members(id,organization_id,user_id,role,licensed,created_at)
      VALUES(?,?,?,'member',0,?)`, [crypto.randomUUID(), ids.team, userId, app.runtime.clock.now()]);
  }
  const mai = await app.login("mai@quire.local");
  const sam = await app.login("sam@quire.local");
  expect((await mai.write("/api/me/notification-preferences", {
    events: {}, channels: ["in-app"], projectOverrides: {}, expectedVersion: 0,
  }, { method: "PATCH" })).status).toBe(200);
  expect((await sam.write("/api/me/notification-preferences", {
    events: { "organization.ai.changed": false }, channels: ["in-app", "email"],
    projectOverrides: {}, expectedVersion: 0,
  }, { method: "PATCH" })).status).toBe(200);
  await app.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [ids.alex]);
  const org = await data(await admin.get(`/api/organizations/${ids.team}`), OrganizationSchema);
  const ai = org.policy.ai === "off" ? "ask" : "off";
  const body = { ai, expectedVersion: org.version };
  expect((await mai.write(`/api/organizations/${ids.team}/policy`, body, { method: "PATCH" })).status).toBe(403);
  expect(await app.runtime.db.all("SELECT id FROM mail_outbox")).toEqual([]);
  expect((await admin.write(`/api/organizations/${ids.team}/policy`, body, { method: "PATCH" })).status).toBe(200);
  const notifications = await app.runtime.db.all("SELECT user_id,kind,resource_id FROM notifications ORDER BY user_id");
  expect(notifications).toEqual([ids.kien, ids.mai].sort().map(userId => ({
    user_id: userId, kind: "organization.ai.changed", resource_id: ids.team,
  })));
  const mail = await app.runtime.db.all("SELECT recipient,dedupe_key,status FROM mail_outbox ORDER BY recipient");
  expect(mail).toEqual([{
    recipient: "kien@quire.local",
    dedupe_key: `governance:${ids.kien}:organization-ai:${ids.team}:${org.version + 1}`,
    status: "local",
  }]);
  // A stale retry and a later non-AI policy edit must not duplicate this change.
  expect((await admin.write(`/api/organizations/${ids.team}/policy`, body, { method: "PATCH" })).status).toBe(409);
  expect((await admin.write(`/api/organizations/${ids.team}/policy`, {
    ai, compileSeconds: org.policy.compileSeconds + 1, expectedVersion: org.version + 1,
  }, { method: "PATCH" })).status).toBe(200);
  expect(await app.runtime.db.all("SELECT user_id,kind,resource_id FROM notifications ORDER BY user_id")).toEqual(notifications);
  expect(await app.runtime.db.all("SELECT recipient,dedupe_key,status FROM mail_outbox ORDER BY recipient")).toEqual(mail);
});

test("AI policy, audit, events and notifications roll back together when mail enqueue fails", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  const org = await data(await admin.get(`/api/organizations/${ids.team}`), OrganizationSchema);
  const snapshot = () => Promise.all([
    app.runtime.db.get("SELECT policy_json,version FROM organizations WHERE id=?", [ids.team]),
    app.runtime.db.all("SELECT * FROM notifications ORDER BY id"),
    app.runtime.db.all("SELECT * FROM governance_notification_receipts ORDER BY user_id,dedupe_key"),
    app.runtime.db.all("SELECT * FROM mail_outbox ORDER BY id"),
    app.runtime.db.all("SELECT * FROM audit_entries ORDER BY id"),
    app.runtime.db.all("SELECT * FROM events ORDER BY seq"),
  ]);
  const before = await snapshot();
  await app.runtime.db.exec(`CREATE TRIGGER reject_ai_notice BEFORE INSERT ON mail_outbox
    WHEN NEW.dedupe_key LIKE 'governance:%:organization-ai:%'
    BEGIN SELECT RAISE(ABORT,'fixture mail enqueue failure'); END`);
  const response = await admin.write(`/api/organizations/${ids.team}/policy`, {
    ai: org.policy.ai === "off" ? "ask" : "off", expectedVersion: org.version,
  }, { method: "PATCH" });
  expect(response.status).toBe(500);
  expect(await snapshot()).toEqual(before);
});
