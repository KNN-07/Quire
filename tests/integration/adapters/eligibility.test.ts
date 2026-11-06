import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { endpoints, MembershipSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { integrationFixture, data } from "./harness";

test("host ticks reconcile institution expiry and domain loss while retaining accounts, projects and independent grants", async () => {
  const listeners = new Set<() => void>();
  let root = "";
  {
    await using fixture = await integrationFixture({ schedulerTicks: { subscribe(listener: () => void) {
      listeners.add(listener); return () => { listeners.delete(listener); };
    } } });
    root = fixture.root;
    console.info("ELIGIBILITY_OWNED", { root });
    const operator = await fixture.login("operator@quire.local");
    const owner = await fixture.login("mai@quire.local");
    const project = await fixture.project(owner);
    await fixture.runtime.db.run("UPDATE organizations SET domains_json=? WHERE id=?", ['["quire.local"]', ids.institution]);
    const institution = z.object({ slug: z.string() }).parse(await fixture.runtime.db.get("SELECT slug FROM organizations WHERE id=?", [ids.institution]));
    expect((await fixture.request(`/api/organizations/${ids.institution}/institution-policy`, {
      method: "PUT", headers: operator.headers, body: JSON.stringify({ reconfirmationDays: 1, expectedVersion: 0 }),
    })).status).toBe(200);
    const expiry = new Date(Date.parse(fixture.clock.now()) + 86_400_000).toISOString();
    for (const [email, userId] of [["mai@quire.local", ids.mai], ["sam@quire.local", ids.sam], ["alex@quire.local", ids.alex]] as const) {
      const user = await fixture.login(email);
      const member = await data(await fixture.request(`/api/institutions/${institution.slug}/enroll`, {
        method: "POST", headers: { ...user.headers, "idempotency-key": crypto.randomUUID() }, body: "{}",
      }), MembershipSchema);
      expect(await fixture.runtime.db.get("SELECT expires_at FROM institutional_eligibility WHERE organization_id=? AND user_id=?",
        [ids.institution, userId])).toMatchObject({ expires_at: expiry });
      if (userId === ids.alex) expect((await fixture.request(`/api/organizations/${ids.institution}/members/${member.id}`, {
        method: "PATCH", headers: operator.headers, body: JSON.stringify({ licensed: true, expectedVersion: member.version }),
      })).status).toBe(200);
    }
    const independent = await data(await fixture.request(`/api/organizations/${ids.team}/members`, {
      method: "POST", headers: { ...operator.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ userId: ids.mai, role: "member", licensed: true, expectedVersion: 0 }),
    }), MembershipSchema);
    fixture.clock.advance(60_000);
    const renewing = await fixture.login("sam@quire.local");
    expect((await fixture.request(`/api/institutions/${institution.slug}/enroll`, {
      method: "POST", headers: { ...renewing.headers, "idempotency-key": crypto.randomUUID() }, body: "{}",
    })).status).toBe(200);
    fixture.clock.advance(86_339_999);
    await fixture.start();
    for (const tick of listeners) tick();
    await fixture.adapters.close();
    expect(listeners.size).toBe(0);
    expect(await fixture.runtime.db.get("SELECT user_id FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.mai])).toMatchObject({ user_id: ids.mai });
    await fixture.restart();
    fixture.clock.advance(1);
    await fixture.start();
    for (const tick of listeners) tick();
    await fixture.adapters.close();
    expect(listeners.size).toBe(0);
    expect(await fixture.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.mai])).toBeNull();
    expect(await fixture.runtime.db.get("SELECT user_id FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.sam])).toMatchObject({ user_id: ids.sam });
    expect(await fixture.runtime.db.get("SELECT licensed FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.alex])).toMatchObject({ licensed: 1 });
    expect(await fixture.runtime.db.get("SELECT licensed FROM members WHERE id=?", [independent.id])).toMatchObject({ licensed: 1 });
    expect(await fixture.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [project.id])).toMatchObject({ owner_id: ids.mai, deleted_at: null });
    expect((await fixture.request(`/api/projects/${project.id}?branch=main`, { headers: owner.headers })).status).toBe(200);
    await fixture.runtime.db.run("UPDATE organizations SET domains_json=? WHERE id=?", ['["changed.example"]', ids.institution]);
    await fixture.restart();
    await fixture.start();
    for (const tick of listeners) tick();
    await fixture.adapters.close();
    expect(listeners.size).toBe(0);
    expect(await fixture.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.sam])).toBeNull();
    expect(await fixture.runtime.db.get("SELECT id FROM institutional_eligibility WHERE organization_id=? AND user_id=?", [ids.institution, ids.sam])).toBeNull();
    const expired = await fixture.login("mai@quire.local");
    expect(await data(await fixture.request(`/api/institutions/${institution.slug}/eligibility`, { headers: expired.headers }),
      endpoints.institutionEligibility.output)).toMatchObject({ member: false, expiresAt: expiry, state: "ineligible" });
    expect(await fixture.runtime.db.get("SELECT licensed FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.alex])).toMatchObject({ licensed: 1 });
    const signedInAgain = await fixture.login("sam@quire.local");
    expect(signedInAgain.user.id).toBe(ids.sam);
    expect(await fixture.runtime.db.get("SELECT suspended,deleted_at FROM users WHERE id=?", [ids.mai])).toMatchObject({ suspended: 0, deleted_at: null });
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("ELIGIBILITY_CLOSED", { root });
}, 240_000);
