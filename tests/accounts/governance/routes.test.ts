import { expect, test } from "bun:test";
import { z } from "zod";
import { MembershipSchema, OrganizationSchema, PolicySchema } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { enqueueNotification, requireEditorOpen } from "../../../services/accounts/governance";

test("deletes an unused organization through a checked aggregate mutation", async () => {
  // Given: an empty newly created organization.
  await using app = await governanceFixture();
  const admin = await app.login();
  const org = await data(await admin.write("/api/organizations", { name: "Temporary", kind: "team", domains: [] }), OrganizationSchema);
  // When: its admin deletes it at the current aggregate version.
  const response = await admin.write(`/api/organizations/${org.id}`, { expectedVersion: 0 }, { method: "DELETE" });
  // Then: normal reads no longer expose the organization.
  expect(response.status).toBe(200);
  expect((await admin.get(`/api/organizations/${org.id}`)).status).toBe(404);
});
test("lists real memberships and exports scoped membership CSV", async () => {
  // Given: a real admin and its persisted organization membership.
  await using app = await governanceFixture();
  const admin = await app.login();
  // When: management reads membership and CSV through HTTP.
  const response = await admin.get(`/api/organizations/${ids.team}/members`);
  const csv = await admin.get(`/api/organizations/${ids.team}/members.csv`);
  // Then: both return actual scoped membership, never account secrets.
  expect((await data(response, z.object({ items: z.array(MembershipSchema) }))).items[0]?.userId).toBe(ids.kien);
  expect(csv.headers.get("content-type")).toContain("text/csv");
  expect(await csv.text()).toContain(ids.kien);
  expect((await data(await admin.get(`/api/organizations/${ids.team}/policy`), PolicySchema)).compileSeconds).toBe(180);
});
test("returns real organization metrics without manufacturing activity", async () => {
  // Given: a seed project with actual files but no compile jobs or AI calls.
  await using app = await governanceFixture();
  const admin = await app.login();
  // When: a manager requests its date-bounded metrics.
  const metrics = await data(await admin.get(`/api/organizations/${ids.team}/metrics?from=2026-10-26T00:00:00.000Z&to=2026-10-27T00:00:00.000Z`),
    z.object({ activeProjects: z.number(), compileCount: z.number(), aiUses: z.number(), storageBytes: z.number() }));
  // Then: persisted activity is counted and absent work remains zero.
  expect(metrics.activeProjects).toBe(1);
  expect(metrics.storageBytes).toBeGreaterThan(0);
  expect(metrics.compileCount).toBe(0);
  expect(metrics.aiUses).toBe(0);
});
test("acknowledges a notification only at its own optimistic version", async () => {
  // Given: an actual private in-app notification.
  await using app = await governanceFixture();
  const user = await app.login("mai@quire.local");
  const id = app.runtime.uow.local(() => enqueueNotification(app.context, { userId: ids.mai, kind: "reply",
    resourceId: ids.project, dedupeKey: "ack", mail: { subject: "Reply", body: "Reply" } }));
  if (!id) throw new TypeError("Notification missing");
  // When: its recipient acknowledges it.
  const response = await user.write(`/api/notifications/${id}/read`, { expectedVersion: 0 });
  // Then: the actual notification is read, and a stale acknowledgement conflicts.
  expect(response.status).toBe(200);
  expect((await data(await user.get("/api/notifications"), z.object({
    items: z.array(z.object({ read: z.boolean(), version: z.number() })),
  }))).items).toEqual([{ read: true, version: 1 }]);
  expect((await user.write(`/api/notifications/${id}/read`, { expectedVersion: 0 })).status).toBe(409);
});
test("persists an editor closure and emits project-scoped refresh events", async () => {
  // Given: an authenticated operator and a real open project.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const events: string[] = [];
  const unsubscribe = app.runtime.events.subscribe((event) => {
    if (event.topic === "policy.changed") events.push(event.aggregateId);
  });
  // When: the operator closes editing.
  const response = await operator.write("/api/admin/editor-state", { closed: true, message: "Maintenance", expectedVersion: 0 });
  unsubscribe();
  // Then: transport consumers receive the actual project scope and the domain guard denies writes.
  expect(response.status).toBe(200);
  expect(events).toEqual([ids.project]);
  expect(() => requireEditorOpen(app.context)).toThrow();
});
