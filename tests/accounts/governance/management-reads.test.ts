import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, MembershipSchema } from "@quire/contracts";
import { data, governanceFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("management readers expose current counters only to organization administrators and the invited account", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  const user = await app.login("mai@quire.local");
  const outsider = await app.login("outsider@quire.local");
  await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 }), MembershipSchema);
  const path = `/api/organizations/${ids.team}/managed`;
  const initial = await admin.get(path);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toMatchObject({ data: { items: expect.arrayContaining([
    expect.objectContaining({ member: expect.objectContaining({ userId: ids.mai }), userVersion: 0, canInvite: true, canReceiveProjects: false, management: null }),
  ]) } });
  expect((await user.get(path)).status).toBe(403);
  expect((await outsider.get(path)).status).toBe(403);
  expect((await app.request(path)).status).toBe(401);
  expect((await admin.write(`/api/organizations/${ids.team}/managed/invite`, { userId: ids.mai, expectedVersion: 1 })).status).toBe(200);
  const own = await user.get("/api/me/management");
  expect(own.headers.get("cache-control")).toBe("private, no-store");
  const invited = await data(own, z.object({ items: z.array(z.object({ id: IdSchema, state: z.string(), version: z.number(), organizationId: IdSchema, organizationName: z.string() })) }));
  expect(invited.items).toHaveLength(1);
  expect(invited.items[0]).toMatchObject({ state: "invited", version: 0, organizationId: ids.team, organizationName: "Robotics Lab" });
  expect(await (await outsider.get("/api/me/management")).json()).toMatchObject({ data: { items: [] } });
  const invitation = invited.items[0];
  if (!invitation) throw new TypeError("Expected management invitation");
  expect((await user.write(`/api/managed/${invitation.id}/accept`, { expectedVersion: invitation.version })).status).toBe(200);
  const current = await admin.get(path);
  expect(current.headers.get("cache-control")).toBe("private, no-store");
  expect(await current.json()).toMatchObject({ data: { items: expect.arrayContaining([
    expect.objectContaining({ member: expect.objectContaining({ userId: ids.mai }), userVersion: 1,
      management: expect.objectContaining({ state: "accepted", version: 1 }), canInvite: false, canRelease: true, canDelete: true, canReceiveProjects: true }),
  ]) } });
});

test("a retained management invitation cannot advertise acceptance after membership removal", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  const user = await app.login("mai@quire.local");
  const member = await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 }), MembershipSchema);
  expect((await admin.write(`/api/organizations/${ids.team}/managed/invite`, { userId: ids.mai, expectedVersion: 1 })).status).toBe(200);
  expect(await (await user.get("/api/me/management")).json()).toMatchObject({ data: { items: [expect.objectContaining({ canAccept: true })] } });
  expect((await admin.write(`/api/organizations/${ids.team}/members/${member.id}`, { expectedVersion: member.version }, { method: "DELETE" })).status).toBe(200);
  expect(await (await user.get("/api/me/management")).json()).toMatchObject({ data: { items: [expect.objectContaining({ state: "invited", canAccept: false })] } });
});
