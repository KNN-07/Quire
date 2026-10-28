import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { baseFixture } from "./harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";
import { bounded } from "../review/harness";

const route = `/api/projects/${ids.project}/transfer`;
test("recomputes all benefits from the recipient and resets finite selection without deleting former-owner access", async () => {
  // Given: a premium owner, basic recipient, and existing assigned collaborators.
  await using app = await baseFixture();
  const owner = await app.login();
  await app.runtime.db.run("UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'",
    [JSON.stringify({ compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false })]);
  await app.runtime.db.run(`INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
    VALUES('user',?,?,1,?)`, [ids.kien, JSON.stringify({ compileSeconds: 90, writableMembers: 3,
    historyDays: null, trackChanges: true }), app.runtime.clock.now()]);
  const source = await app.service.readDocument({ projectId: ids.project, branch: "main" }, ids.mainFile);
  // When: ordinary transfer commits through its real owner-only endpoint.
  const response = await app.request(route, { method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ newOwnerId: ids.mai, expectedVersion: 0 }) });
  // Then: former-owner membership survives but no former grant or selection survives.
  expect(response.status).toBe(200);
  expect(await app.service.role(ids.kien, ids.project)).toBe("editor");
  expect(await app.service.effectiveRole(ids.kien, ids.project)).toBe("viewer");
  expect(await app.service.policy(ids.kien, ids.project)).toMatchObject({
    compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false,
  });
  expect(await app.runtime.db.get("SELECT owner_id,writable_member_ids_json FROM projects WHERE id=?", [ids.project]))
    .toEqual({ owner_id: ids.mai, writable_member_ids_json: "[]" });
  expect((await app.service.readDocument({ projectId: ids.project, branch: "main" }, ids.mainFile)).text).toBe(source.text);
  const notified = z.array(z.object({ user_id: z.string() })).parse(await app.runtime.db.all(
    "SELECT user_id FROM notifications WHERE kind='project.transferred' ORDER BY user_id"));
  expect(notified.map(row => row.user_id)).toEqual([ids.kien, ids.mai]);
});

for (const mutation of ["suspend", "remove", "sharing", "managed"] as const) {
  test(`rechecks transfer ${mutation} changes inside the account transaction`, async () => {
    // Given: a valid transfer preflight and a deterministic change before its transaction.
    await using app = await baseFixture();
    const owner = await app.login();
    if (mutation === "sharing") await app.runtime.db.run("UPDATE organizations SET policy_json=?",
      [JSON.stringify({ ...defaultPolicy, sharing: "anyone" })]);
    const check = app.service.checkSharing.bind(app.service);
    const barrier = spyOn(app.service, "checkSharing").mockImplementationOnce(async (...args) => {
      await check(...args);
      await app.runtime.uow.run(async tx => {
        await tx.lock("quire:accounts");
        switch (mutation) {
          case "suspend": await tx.run("UPDATE users SET suspended=1 WHERE id=?", [ids.mai]); break;
          case "remove": await tx.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.mai]); break;
          case "managed": await tx.run("UPDATE users SET managed_by=? WHERE id=?", [ids.team, ids.kien]); break;
          case "sharing":
            await tx.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
              [crypto.randomUUID(), ids.project, JSON.stringify({ ...defaultPolicy, sharing: "organization" }), app.runtime.clock.now()]);
            break;
        }
      });
      if (mutation === "sharing") expect((await app.service.policy(ids.kien, ids.project)).sharing).toBe("organization");
    });
    try {
      // When: the prepared transfer resumes against current authority.
      const response = await app.request(route, { method: "POST",
        headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ newOwnerId: ids.mai, expectedVersion: 0 }) });
      // Then: no transaction can publish a stale target, sharing policy, or management bypass.
      expect(response.status).toBe(mutation === "suspend" || mutation === "remove" ? 404 : 403);
      if (mutation === "managed") expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code)
        .toBe("MANAGED_TRANSFER_REQUIRED");
      expect((await app.service.getProject(ids.project)).ownerId).toBe(ids.kien);
      expect(await app.runtime.db.all("SELECT id FROM notifications WHERE kind='project.transferred'")).toHaveLength(0);
    } finally { barrier.mockRestore(); }
  });
}
test("rejects the losing concurrent transfer by its stale project version", async () => {
  // Given: two distinct recipients whose ordinary-owner preflights both finish before either account transaction.
  await using app = await baseFixture();
  await using replica = await app.replica();
  const owner = await app.login();
  const check = app.service.checkSharing.bind(app.service);
  const peerCheck = replica.service.checkSharing.bind(replica.service);
  const entered = Promise.withResolvers<void>();
  const peerEntered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const peerRelease = Promise.withResolvers<void>();
  const barrier = spyOn(app.service, "checkSharing").mockImplementationOnce(async (...args) => {
    await check(...args);
    entered.resolve();
    await bounded(release.promise);
  });
  const peerBarrier = spyOn(replica.service, "checkSharing").mockImplementationOnce(async (...args) => {
    await peerCheck(...args);
    peerEntered.resolve();
    await bounded(peerRelease.promise);
  });
  const request = { method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ newOwnerId: ids.mai, expectedVersion: 0 }) };
  const first = app.request(route, request);
  let second: Promise<Response> | undefined;
  try {
    await bounded(entered.promise);
    second = replica.request(route, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ newOwnerId: ids.sam, expectedVersion: 0 }) });
    await bounded(peerEntered.promise);
    // When: independently prepared runtimes commit in a controlled account-lock order.
    release.resolve();
    const winner = await first;
    peerRelease.resolve();
    const results = [winner, await second];
    // Then: exactly one ownership transition and its two notifications commit.
    expect(results.map(result => result.status).sort((left, right) => left - right)).toEqual([200, 409]);
    expect([ids.mai, ids.sam]).toContain((await app.service.getProject(ids.project)).ownerId);
    expect(await app.runtime.db.all("SELECT id FROM notifications WHERE kind='project.transferred'")).toHaveLength(2);
  } finally {
    release.resolve(); peerRelease.resolve();
    await first;
    if (second) await second;
    barrier.mockRestore(); peerBarrier.mockRestore();
  }
}, 30000);
