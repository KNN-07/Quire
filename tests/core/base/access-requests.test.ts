import { expect, test } from "bun:test";
import { z } from "zod";
import { AccessRequestSchema } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test.each([
  ["alex", "reviewer", 200],
  ["alex", "editor", 200],
  ["sam", "editor", 200],
  ["sam", "reviewer", 403],
  ["mai", "reviewer", 403],
  ["mai", "editor", 403],
  ["kien", "editor", 403],
] as const)("access request by %s for %s returns %i without changing membership", async (name, role, status) => {
  // Given an actual seeded project role and authenticated account.
  await using app = await baseFixture();
  const actor = await app.login(`${name}@quire.local`);
  const before = await app.service.role(actor.user.id, ids.project);
  // When that account requests a role.
  const response = await app.request(`/api/projects/${ids.project}/access-requests`, {
    method: "POST", headers: { ...actor.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ role, message: "Review the paper", expectedVersion: 0 }),
  });
  // Then only a genuine upgrade is pending; a request grants nothing.
  expect(response.status).toBe(status);
  expect(await app.service.role(actor.user.id, ids.project)).toBe(before);
  expect((await app.runtime.db.all("SELECT id FROM access_requests")).length).toBe(status === 200 ? 1 : 0);
});

test("a replayed access request queues one owner notification and email", async () => {
  // Given a Viewer and the owner's default notification preferences.
  await using app = await baseFixture();
  const viewer = await app.login("alex@quire.local");
  const request = {
    method: "POST", headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ role: "editor", message: "Collaborate", expectedVersion: 0 }),
  };
  // When the same HTTP operation is delivered twice.
  const first = await app.request(`/api/projects/${ids.project}/access-requests`, request);
  const item = z.object({ data: AccessRequestSchema }).parse(await first.json()).data;
  const replay = await app.request(`/api/projects/${ids.project}/access-requests`, request);
  expect(z.object({ data: AccessRequestSchema }).parse(await replay.json()).data).toEqual(item);
  // Then durable notice and mail are attributed once to the current owner.
  expect(await app.runtime.db.all("SELECT user_id,kind,resource_id FROM notifications")).toEqual([
    { user_id: ids.kien, kind: "project.access.requested", resource_id: ids.project },
  ]);
  expect(await app.runtime.db.all("SELECT recipient,dedupe_key,status FROM mail_outbox")).toEqual([
    { recipient: "kien@quire.local", dedupe_key: `governance:${ids.kien}:access-request:${item.id}`, status: "local" },
  ]);
});

test("request creation rolls back when its owner mail cannot be queued", async () => {
  // Given an actual transactional mail failure.
  await using app = await baseFixture();
  const viewer = await app.login("alex@quire.local");
  const snapshot = () => Promise.all([
    app.runtime.db.all("SELECT * FROM access_requests"),
    app.runtime.db.all("SELECT * FROM notifications"),
    app.runtime.db.all("SELECT * FROM governance_notification_receipts"),
    app.runtime.db.all("SELECT * FROM mail_outbox"),
    app.runtime.db.all("SELECT * FROM events ORDER BY seq"),
    app.runtime.db.get("SELECT version FROM projects WHERE id=?", [ids.project]),
  ]);
  const before = await snapshot();
  await app.runtime.db.exec(`CREATE TRIGGER reject_access_notice BEFORE INSERT ON mail_outbox
    WHEN NEW.dedupe_key LIKE 'governance:%:access-request:%'
    BEGIN SELECT RAISE(ABORT,'fixture mail enqueue failure'); END`);
  // When a Viewer submits a legitimate upgrade request.
  const response = await app.request(`/api/projects/${ids.project}/access-requests`, {
    method: "POST", headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ role: "editor", message: "Collaborate", expectedVersion: 0 }),
  });
  // Then neither the request nor its events/notices survive a partial failure.
  expect(response.status).toBe(500);
  expect(await snapshot()).toEqual(before);
});

test("accepting an obsolete request cannot downgrade a newly promoted member", async () => {
  // Given a pending Viewer-to-Reviewer request followed by an Editor promotion.
  await using app = await baseFixture();
  const viewer = await app.login("alex@quire.local");
  const owner = await app.login();
  const created = await app.request(`/api/projects/${ids.project}/access-requests`, {
    method: "POST", headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ role: "reviewer", message: "Review", expectedVersion: 0 }),
  });
  const item = z.object({ data: AccessRequestSchema }).parse(await created.json()).data;
  await app.runtime.db.run("UPDATE project_members SET role='editor',version=version+1 WHERE project_id=? AND user_id=?",
    [ids.project, ids.alex]);
  // When the owner accepts the now-obsolete request.
  const decision = await app.request(`/api/projects/${ids.project}/access-requests/${item.id}/decide`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ accept: true, expectedVersion: item.version }),
  });
  // Then the higher role and pending request remain intact for explicit disposition.
  expect(decision.status).toBe(403);
  expect(await app.service.role(ids.alex, ids.project)).toBe("editor");
  expect(await app.runtime.db.get("SELECT status,version FROM access_requests WHERE id=?", [item.id]))
    .toEqual({ status: "pending", version: 0 });
});

test("owner opt-out suppresses access-request notices without suppressing the request", async () => {
  // Given an owner who disabled this event through the real preference endpoint.
  await using app = await baseFixture();
  const owner = await app.login();
  const viewer = await app.login("alex@quire.local");
  const preference = await app.request("/api/me/notification-preferences", {
    method: "PATCH", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      events: { "project.access.requested": false }, channels: ["in-app", "email"],
      projectOverrides: {}, expectedVersion: 0,
    }),
  });
  expect(preference.status).toBe(200);
  // When an eligible request arrives.
  const response = await app.request(`/api/projects/${ids.project}/access-requests`, {
    method: "POST", headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ role: "editor", message: "Collaborate", expectedVersion: 0 }),
  });
  // Then the owner can still manage the request without unwanted messages.
  expect(response.status).toBe(200);
  expect(await app.runtime.db.all("SELECT id FROM access_requests")).toHaveLength(1);
  expect(await app.runtime.db.all("SELECT id FROM notifications")).toEqual([]);
  expect(await app.runtime.db.all("SELECT id FROM mail_outbox")).toEqual([]);
});
