import { expect, test } from "bun:test";
import { z } from "zod";
import { ManagedLifecycleScheduleSchema } from "@quire/contracts";
import { data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { lifecycleClient, lifecycleFixture, lifecycleState, prepareLifecycle, schedulePath, settings, transitionPath } from "./lifecycle-fixture";
import { reconcileManagedLifecycle } from "../../../services/accounts/governance/lifecycle";

test("lifecycle configuration is opt-in, CAS protected, fresh, and bound to a real organization admin", async () => {
  await using fixture = await lifecycleFixture();
  const { admin, api } = await prepareLifecycle(fixture);
  const initial = await data(await fixture.request(schedulePath, { headers: admin.headers }), ManagedLifecycleScheduleSchema);
  expect(initial).toMatchObject({ version: 0, authorizedBy: null, authorityValid: false,
    settings: { enabled: false, transferTo: null, softDeleteDays: 60, deletionDays: 90 } });
  expect((await api.write(transitionPath(ids.mai), { action: "lapse", expectedVersion: 1 })).status).toBe(409);
  expect((await lifecycleState(fixture, ids.mai)).state).toBe("accepted");
  const operator = lifecycleClient(fixture, await fixture.login("operator@quire.local"));
  const member = lifecycleClient(fixture, await fixture.login("mai@quire.local"));
  for (const actor of [operator, member]) {
    expect((await actor.write(schedulePath, { settings, expectedVersion: 0 }, "PUT")).status).toBe(403);
  }
  expect((await api.write(schedulePath, { settings: { ...settings, deletionDays: 60 }, expectedVersion: 0 }, "PUT")).status).toBe(400);
  expect((await api.write(schedulePath, { settings: { ...settings, transferTo: ids.operator }, expectedVersion: 0 }, "PUT")).status).toBe(409);
  const saved = await data(await api.write(schedulePath, { settings, expectedVersion: 0 }, "PUT"), ManagedLifecycleScheduleSchema);
  expect(saved).toMatchObject({ version: 1, authorizedBy: ids.kien, authorityValid: true, settings });
  expect((await api.write(schedulePath, { settings, expectedVersion: 0 }, "PUT")).status).toBe(409);
  expect((await api.write(transitionPath(ids.kien), { action: "lapse", expectedVersion: 1 })).status).toBe(409);
  expect((await fixture.request(schedulePath, { method: "PUT", headers: { cookie: admin.headers.cookie },
    body: JSON.stringify({ settings, expectedVersion: 1 }) })).status).toBe(403);
  fixture.setTime("2026-10-26T12:15:00.001Z");
  expect((await api.write(schedulePath, { settings, expectedVersion: 1 }, "PUT")).status).toBe(403);
  expect(await fixture.runtime.db.get("SELECT version FROM managed_lifecycle_policies WHERE organization_id=?", [ids.team])).toEqual({ version: 1 });
}, 120_000);

test("scheduled custom intervals have exact due boundaries, recovery and disabled denial", async () => {
  await using fixture = await lifecycleFixture();
  const { api } = await prepareLifecycle(fixture);
  expect((await api.write(schedulePath, { settings: { ...settings, softDeleteDays: 1, deletionDays: 2 }, expectedVersion: 0 }, "PUT")).status).toBe(200);
  expect((await api.write(transitionPath(ids.mai), { action: "lapse", expectedVersion: 1 })).status).toBe(200);
  expect((await api.write(transitionPath(ids.sam), { action: "lapse", expectedVersion: 1 })).status).toBe(200);
  fixture.setTime("2026-10-27T11:59:59.999Z");
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([]);
  expect((await lifecycleState(fixture, ids.mai)).state).toBe("suspended");
  fixture.setTime("2026-10-27T12:00:00.000Z");
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([]);
  expect((await lifecycleState(fixture, ids.mai))).toMatchObject({ state: "soft_deleted", version: 3 });
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([]);
  expect((await lifecycleState(fixture, ids.mai)).version).toBe(3);
  const fresh = lifecycleClient(fixture, await fixture.login());
  expect((await fresh.write(transitionPath(ids.mai), { action: "recover", expectedVersion: 3 })).status).toBe(200);
  expect((await lifecycleState(fixture, ids.mai))).toMatchObject({ state: "accepted", lapse_at: null, version: 4 });
  expect((await fresh.write(schedulePath, { settings: { ...settings, enabled: false }, expectedVersion: 1 }, "PUT")).status).toBe(200);
  fixture.setTime("2027-01-30T12:00:00.000Z");
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([]);
  expect((await lifecycleState(fixture, ids.sam)).state).toBe("soft_deleted");
  expect(await fixture.runtime.db.get("SELECT deleted_at,suspended FROM users WHERE id=?", [ids.mai]))
    .toEqual({ deleted_at: null, suspended: 0 });
  const later = lifecycleClient(fixture, await fixture.login());
  expect((await later.write(transitionPath(ids.mai), { action: "lapse", expectedVersion: 4 })).status).toBe(409);
  expect((await later.write(transitionPath(ids.sam), { action: "recover", expectedVersion: 3 })).status).toBe(200);
  expect(z.object({ count: z.number() }).parse(await fixture.runtime.db.get(
    "SELECT count(*) AS count FROM audit_entries WHERE event='managed.advance'")).count).toBe(2);
}, 120_000);

test("scheduled deletion retains last operators and rejects lost ownership or inactive authorizing admins", async () => {
  await using fixture = await lifecycleFixture();
  const { api } = await prepareLifecycle(fixture);
  expect((await api.write(schedulePath, { settings, expectedVersion: 0 }, "PUT")).status).toBe(200);
  await fixture.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [ids.operator]);
  await fixture.runtime.db.run("UPDATE users SET operator=1 WHERE id=?", [ids.mai]);
  expect((await api.write(transitionPath(ids.mai), { action: "lapse", expectedVersion: 1 })).status).toBe(409);
  expect((await lifecycleState(fixture, ids.mai)).state).toBe("accepted");
  await fixture.runtime.db.run("UPDATE users SET operator=1 WHERE id=?", [ids.operator]);
  expect((await api.write(transitionPath(ids.mai), { action: "lapse", expectedVersion: 1 })).status).toBe(200);
  await fixture.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [ids.operator]);
  fixture.setTime("2027-01-24T12:00:00.000Z");
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([{ organizationId: ids.team, userId: ids.mai, code: "LAST_OPERATOR" }]);
  expect((await lifecycleState(fixture, ids.mai)).state).toBe("suspended");
  await fixture.runtime.db.run("UPDATE users SET operator=1 WHERE id=?", [ids.operator]);
  await fixture.runtime.db.run("UPDATE users SET managed_by=NULL WHERE id=?", [ids.mai]);
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([{ organizationId: ids.team, userId: ids.mai, code: "MANAGED_CONFLICT" }]);
  await fixture.runtime.db.run("UPDATE users SET managed_by=? WHERE id=?", [ids.team, ids.mai]);
  await fixture.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [ids.kien]);
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([{ organizationId: ids.team, userId: ids.mai, code: "LIFECYCLE_AUTHORITY_REVOKED" }]);
  expect(await fixture.runtime.db.get("SELECT password_hash IS NOT NULL AS retained,deleted_at FROM users WHERE id=?", [ids.mai]))
    .toEqual({ retained: 1, deleted_at: null });
}, 120_000);

test("a failed final audit rolls back transfer and deletion without stopping another due account", async () => {
  await using fixture = await lifecycleFixture();
  const { api } = await prepareLifecycle(fixture);
  expect((await api.write(schedulePath, { settings, expectedVersion: 0 }, "PUT")).status).toBe(200);
  await fixture.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [ids.mai, ids.project]);
  for (const userId of [ids.mai, ids.sam])
    expect((await api.write(transitionPath(userId), { action: "lapse", expectedVersion: 1 })).status).toBe(200);
  await fixture.runtime.db.run(`CREATE TRIGGER lifecycle_fixture_audit_failure BEFORE INSERT ON audit_entries
    WHEN NEW.event='managed.advance' AND NEW.target_id='${ids.mai}'
    BEGIN SELECT RAISE(ABORT,'isolated lifecycle audit failure'); END`);
  fixture.setTime("2027-01-24T12:00:00.000Z");
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([{ organizationId: ids.team, userId: ids.mai, code: "LIFECYCLE_FAILED" }]);
  expect((await lifecycleState(fixture, ids.mai))).toMatchObject({ state: "suspended", version: 2 });
  expect((await lifecycleState(fixture, ids.sam)).state).toBe("deleted");
  expect(await fixture.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [ids.project])).toEqual({ owner_id: ids.mai });
  expect(await fixture.runtime.db.get("SELECT password_hash IS NOT NULL AS retained,managed_by FROM users WHERE id=?", [ids.mai]))
    .toEqual({ retained: 1, managed_by: ids.team });
  expect(await fixture.runtime.db.get("SELECT error_code FROM managed_lifecycle_results WHERE user_id=?", [ids.mai])).toEqual({ error_code: "LIFECYCLE_FAILED" });
  await fixture.runtime.db.run("DROP TRIGGER lifecycle_fixture_audit_failure");
  expect(await reconcileManagedLifecycle(fixture.context)).toEqual([]);
  expect((await lifecycleState(fixture, ids.mai)).state).toBe("deleted");
  expect(await fixture.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [ids.project])).toEqual({ owner_id: ids.kien });
}, 120_000);
