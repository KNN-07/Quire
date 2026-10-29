import { expect, test } from "bun:test";
import { baseFixture, password } from "../../core/base/harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

for (const otherAdmin of ["none", "suspended"] as const) {
  test(`self-deletion preserves an organization's last active admin when another admin is ${otherAdmin}`, async () => {
    // Given: the current owner is the only usable organization administrator.
    await using fixture = await baseFixture();
    const owner = await fixture.login();
    if (otherAdmin === "suspended") {
      await fixture.runtime.db.run(`INSERT INTO members(id,organization_id,user_id,role,licensed,created_at)
        VALUES(?,?,?,'admin',0,?)`, [crypto.randomUUID(), ids.team, ids.alex, fixture.runtime.clock.now()]);
      await fixture.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [ids.alex]);
    }
    const members = await fixture.runtime.db.all("SELECT * FROM members ORDER BY id");
    // When: project reassignment is supplied but organization administration is not preserved.
    const response = await fixture.request("/api/me", { method: "DELETE", headers: owner.headers,
      body: JSON.stringify({ confirmation: owner.user.primaryEmail, password, expectedVersion: 0,
        reassignment: { [ids.project]: ids.mai } }) });
    // Then: the account and organization remain usable, without partial project transfer.
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "LAST_ADMIN" } });
    expect(await fixture.runtime.db.all("SELECT * FROM members ORDER BY id")).toEqual(members);
    expect((await fixture.service.getProject(ids.project)).ownerId).toBe(ids.kien);
    expect((await fixture.request("/api/me", { headers: owner.headers })).status).toBe(200);
  });
}

test("already-deleted owned projects do not permanently prevent confirmed self-deletion", async () => {
  // Given: an account with no organization administration has deleted its owned project.
  await using fixture = await baseFixture();
  const owner = await fixture.login("outsider@quire.local");
  const project = await fixture.create(owner.headers, "Deleted before account");
  const files = await fixture.runtime.db.all(`SELECT f.* FROM files f JOIN branch_workspaces b ON b.id=f.branch_id
    WHERE b.project_id=? ORDER BY f.id`, [project.id]);
  expect((await fixture.request(`/api/projects/${project.id}`, {
    method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ confirmation: project.name, expectedVersion: project.version }),
  })).status).toBe(200);
  // When: the account confirms self-deletion without inventing a recipient for inaccessible deleted content.
  const response = await fixture.request("/api/me", { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ confirmation: owner.user.primaryEmail, password, expectedVersion: 0 }) });
  // Then: account access ends; deleted content is neither restored, reassigned nor physically erased.
  expect(response.status).toBe(200);
  expect((await fixture.request("/api/me", { headers: owner.headers })).status).toBe(401);
  expect(await fixture.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [project.id]))
    .toMatchObject({ owner_id: owner.user.id, deleted_at: expect.any(String) });
  expect(await fixture.runtime.db.all(`SELECT f.* FROM files f JOIN branch_workspaces b ON b.id=f.branch_id
    WHERE b.project_id=? ORDER BY f.id`, [project.id])).toEqual(files);
});
