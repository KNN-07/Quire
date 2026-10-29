import { expect, test } from "bun:test";
import { z } from "zod";
import { MembershipSchema, OrganizationSchema, InvitationSchema, IdSchema } from "@quire/contracts";
import { data, governanceFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("institution administrators cannot bypass self-enrollment or acquire account management", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  const user = await app.login("mai@quire.local");
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'admin',0,?)",
    [crypto.randomUUID(), ids.institution, ids.kien, app.runtime.clock.now()]);
  await app.runtime.db.run("UPDATE organizations SET domains_json=? WHERE id=?", ['["eligible.example"]', ids.institution]);
  const path = `/api/organizations/${ids.institution}`;
  for (const role of ["member", "manager", "admin"]) {
    expect((await admin.write(`${path}/members`, { userId: ids.mai, role, licensed: false, expectedVersion: 0 })).status).toBe(409);
    expect((await admin.write(`${path}/invitations`, { email: "mai@quire.local", role, expectedVersion: 0 })).status).toBe(409);
  }
  expect(await app.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.mai])).toBeNull();
  const institution = await data(await admin.get(path), OrganizationSchema);
  expect((await user.write(`/api/institutions/${institution.slug}/enroll`)).status).toBe(403);
  await app.runtime.db.run("UPDATE organizations SET domains_json=? WHERE id=?", ['["quire.local"]', ids.institution]);
  const enrolled = await data(await user.write(`/api/institutions/${institution.slug}/enroll`), MembershipSchema);
  expect(enrolled).toMatchObject({ userId: ids.mai, role: "member", licensed: false });
  expect((await admin.write(`${path}/members/${enrolled.id}`, { role: "manager", expectedVersion: enrolled.version }, { method: "PATCH" })).status).toBe(200);
  expect((await admin.write(`${path}/managed/invite`, { userId: ids.mai, expectedVersion: 0 })).status).toBe(409);
  expect(await app.runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.mai])).toMatchObject({ managed_by: null });
  expect(await app.runtime.db.get("SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.institution, ids.mai])).toBeNull();
});

test("organization kind cannot change after creation to bypass institution enrollment", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  expect((await admin.write(`/api/organizations/${ids.team}`, { kind: "institution", expectedVersion: 0 }, { method: "PATCH" })).status).toBe(409);
  expect(await app.runtime.db.get("SELECT kind,version FROM organizations WHERE id=?", [ids.team])).toMatchObject({ kind: "team", version: 0 });
});

test("institution state rejects pending membership and management acceptance from earlier team state", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  const user = await app.login("mai@quire.local");
  const other = await app.login("sam@quire.local");
  const org = await data(await admin.write("/api/organizations", { name: "Earlier team", kind: "team", domains: ["quire.local"] }), OrganizationSchema);
  const path = `/api/organizations/${org.id}`;
  const invited = await data(await admin.write(`${path}/invitations`, { email: "mai@quire.local", role: "member", expectedVersion: 0 }), InvitationSchema);
  expect((await admin.write(`${path}/members`, { userId: ids.sam, role: "member", licensed: false, expectedVersion: 1 })).status).toBe(200);
  expect((await admin.write(`${path}/managed/invite`, { userId: ids.sam, expectedVersion: 2 })).status).toBe(200);
  const management = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [org.id, ids.sam]));
  const mail = z.object({ body: z.string() }).parse(await app.runtime.db.get("SELECT body FROM mail_outbox WHERE dedupe_key=?", [`organization-invite:${invited.id}:0`]));
  // Model a retained older record, not a currently permitted kind-change operation.
  await app.runtime.db.run("UPDATE organizations SET kind='institution' WHERE id=?", [org.id]);
  expect((await user.write(`/api/organization-invitations/${invited.id}/accept`, { token: new URL(mail.body).searchParams.get("token"), expectedVersion: 0 })).status).toBe(409);
  expect((await other.write(`/api/managed/${management.id}/accept`, { expectedVersion: 0 })).status).toBe(409);
  expect(await app.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [org.id, ids.mai])).toBeNull();
  expect(await app.runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.sam])).toMatchObject({ managed_by: null });
});
