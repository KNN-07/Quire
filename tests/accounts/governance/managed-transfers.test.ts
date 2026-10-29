import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, MembershipSchema } from "@quire/contracts";
import { data, governanceFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { transitionManaged } from "../../../services/accounts/governance";

test("managed deletion requires the recipient's accepted management, not membership or a pending invitation", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  const owner = await app.login("mai@quire.local");
  await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 }), MembershipSchema);
  expect((await admin.write(`/api/organizations/${ids.team}/managed/invite`, { userId: ids.mai, expectedVersion: 1 })).status).toBe(200);
  const donor = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.team, ids.mai]));
  expect((await owner.write(`/api/managed/${donor.id}/accept`, { expectedVersion: 0 })).status).toBe(200);
  await app.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [ids.mai, ids.project]);
  const path = `/api/organizations/${ids.team}/managed/${ids.mai}/delete`;
  const body = { transferTo: ids.kien, expectedVersion: 1 };
  expect((await admin.write(path, body)).status).toBe(409);
  expect((await owner.get("/api/me")).status).toBe(200);
  expect((await admin.write(`/api/organizations/${ids.team}/managed/invite`, { userId: ids.kien, expectedVersion: 1 })).status).toBe(200);
  const recipient = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.team, ids.kien]));
  expect((await admin.write(path, body)).status).toBe(409);
  expect(await app.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [ids.project])).toMatchObject({ owner_id: ids.mai });
  expect((await admin.write(`/api/managed/${recipient.id}/accept`, { expectedVersion: 0 })).status).toBe(200);
  expect((await admin.write(path, body)).status).toBe(200);
  expect(await app.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [ids.project])).toMatchObject({ owner_id: ids.kien });
  expect((await owner.get("/api/me")).status).toBe(401);
});

test("terminal managed lifecycle refuses an unmanaged recipient without deleting the lapsed owner", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  const owner = await app.login("mai@quire.local");
  await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 }), MembershipSchema);
  expect((await admin.write(`/api/organizations/${ids.team}/managed/invite`, { userId: ids.mai, expectedVersion: 1 })).status).toBe(200);
  const acceptance = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.team, ids.mai]));
  expect((await owner.write(`/api/managed/${acceptance.id}/accept`, { expectedVersion: 0 })).status).toBe(200);
  await app.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [ids.mai, ids.project]);
  await transitionManaged(app.context, admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 1, action: "lapse" });
  app.setTime("2027-01-24T12:00:00.000Z");
  const failure = await transitionManaged(app.context, admin.principal, {
    organizationId: ids.team, userId: ids.mai, expectedVersion: 2, action: "advance", transferTo: ids.kien,
  }).then(() => null, (cause: unknown) => cause);
  expect(failure).toMatchObject({ code: "INVALID_TRANSFER" });
  expect(await app.runtime.db.get("SELECT state,version FROM managed_acceptances WHERE id=?", [acceptance.id])).toMatchObject({ state: "suspended", version: 2 });
  expect(await app.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [ids.project])).toMatchObject({ owner_id: ids.mai });
});
