import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { IdSchema, ManagedLifecycleScheduleSchema } from "@quire/contracts";
import { integrationFixture, data } from "../../integration/adapters/harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { lifecycleClient, lifecycleState, prepareLifecycle, schedulePath, settings, transitionPath } from "../../accounts/governance/lifecycle-fixture";

test("default host ticks honor persisted authority, restart, due boundaries, disable and recovery without a system principal", async () => {
  const listeners = new Set<() => void>();
  let root = "";
  {
    await using fixture = await integrationFixture({ schedulerTicks: { subscribe(listener) {
      listeners.add(listener); return () => { listeners.delete(listener); };
    } } });
    root = fixture.root; console.info("MANAGED_HOST_OWNED", { root });
    const { api } = await prepareLifecycle(fixture);
    expect((await api.write(schedulePath, { settings, expectedVersion: 0 }, "PUT")).status).toBe(200);
    expect((await api.write(transitionPath(ids.mai), { action: "lapse", expectedVersion: 1 })).status).toBe(200);
    async function tick() {
      await fixture.start();
      expect(listeners.size).toBe(5);
      for (const listener of listeners) listener();
      await fixture.adapters.close();
      expect(listeners.size).toBe(0);
    }
    fixture.clock.advance(60 * 86_400_000 - 1);
    await tick();
    expect((await lifecycleState(fixture, ids.mai)).state).toBe("suspended");
    await fixture.restart();
    fixture.clock.advance(1); await tick();
    expect((await lifecycleState(fixture, ids.mai))).toMatchObject({ state: "soft_deleted", version: 3 });
    await fixture.restart();
    const current = lifecycleClient(fixture, await fixture.login());
    expect((await current.write(schedulePath, { settings: { ...settings, enabled: false }, expectedVersion: 1 }, "PUT")).status).toBe(200);
    fixture.clock.advance(30 * 86_400_000); await tick();
    expect((await lifecycleState(fixture, ids.mai)).state).toBe("soft_deleted");
    await fixture.restart();
    const recovery = lifecycleClient(fixture, await fixture.login());
    expect((await recovery.write(transitionPath(ids.mai), { action: "recover", expectedVersion: 3 })).status).toBe(200);
    expect((await recovery.write(schedulePath, { settings, expectedVersion: 2 }, "PUT")).status).toBe(200);
    expect((await recovery.write(transitionPath(ids.mai), { action: "lapse", expectedVersion: 4 })).status).toBe(200);
    // A demotion and later promotion must not resurrect the previously saved grant.
    await fixture.runtime.db.run("UPDATE members SET role='member',version=version+1 WHERE organization_id=? AND user_id=?", [ids.team, ids.kien]);
    await fixture.runtime.db.run("UPDATE members SET role='admin',version=version+1 WHERE organization_id=? AND user_id=?", [ids.team, ids.kien]);
    await fixture.restart();
    fixture.clock.advance(90 * 86_400_000); await tick();
    expect((await lifecycleState(fixture, ids.mai)).state).toBe("suspended");
    const admin = await fixture.login();
    const read = await data(await fixture.request(schedulePath, { headers: admin.headers }), ManagedLifecycleScheduleSchema);
    expect(read.authorityValid).toBe(false);
    expect(read.accounts.find(account => account.userId === ids.mai)?.errorCode).toBe("LIFECYCLE_AUTHORITY_REVOKED");
    expect(read.accounts.find(account => account.userId === ids.mai)?.nextStage).toBe("deleted");
    expect(read.accounts.find(account => account.userId === ids.mai)?.nextAt).toBe(fixture.clock.now());
    expect(await fixture.runtime.db.get("SELECT actor_id FROM audit_entries WHERE event='managed.advance'"))
      .toEqual({ actor_id: ids.kien });
    expect(await fixture.runtime.db.get("SELECT suspended,deleted_at FROM users WHERE id=?", [ids.mai]))
      .toEqual({ suspended: 1, deleted_at: null });
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("MANAGED_HOST_CLOSED", { root, listeners: listeners.size });
}, 180_000);

test("host continues past a last-admin failure and transfers before final deletion; invalid recipients fail closed", async () => {
  const listeners = new Set<() => void>();
  let root = "";
  {
    await using fixture = await integrationFixture({ schedulerTicks: { subscribe(listener) {
      listeners.add(listener); return () => { listeners.delete(listener); };
    } } });
    root = fixture.root; console.info("MANAGED_HOST_OWNED", { root });
    const { api } = await prepareLifecycle(fixture);
    const other = IdSchema.parse(crypto.randomUUID());
    await fixture.runtime.db.run(`INSERT INTO organizations(id,slug,name,kind,domains_json,policy_json,created_at,updated_at)
      SELECT ?,'lifecycle-guard','Retained billing organization','team','[]',policy_json,created_at,updated_at FROM organizations WHERE id=?`, [other, ids.team]);
    await fixture.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'admin',0,?)",
      [crypto.randomUUID(), other, ids.mai, fixture.clock.now()]);
    await fixture.runtime.db.run(`INSERT INTO billing_accounts(id,organization_id,provider,period,status,invoice_email,created_at)
      VALUES(?,?,'manual','month','active','billing@fixture.invalid',?)`, [crypto.randomUUID(), other, fixture.clock.now()]);
    const billing = await fixture.runtime.db.all("SELECT * FROM billing_accounts WHERE organization_id=?", [other]);
    await fixture.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [ids.sam, ids.project]);
    expect((await api.write(schedulePath, { settings, expectedVersion: 0 }, "PUT")).status).toBe(200);
    for (const userId of [ids.mai, ids.sam, ids.alex])
      expect((await api.write(transitionPath(userId), { action: "lapse", expectedVersion: 1 })).status).toBe(200);
    // A pending invitation cannot replace an accepted recipient, even after configuration.
    await fixture.runtime.db.run("UPDATE managed_acceptances SET state='invited' WHERE user_id=? AND organization_id=?", [ids.kien, ids.team]);
    fixture.clock.advance(90 * 86_400_000);
    async function tick() {
      await fixture.start(); for (const listener of listeners) listener();
      await fixture.adapters.close(); expect(listeners.size).toBe(0);
    }
    await tick();
    expect((await lifecycleState(fixture, ids.sam)).state).toBe("suspended");
    expect(await fixture.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [ids.project])).toEqual({ owner_id: ids.sam });
    expect(await fixture.runtime.db.get("SELECT error_code FROM managed_lifecycle_results WHERE user_id=?", [ids.sam])).toEqual({ error_code: "INVALID_TRANSFER" });
    await fixture.runtime.db.run("UPDATE managed_acceptances SET state='accepted' WHERE user_id=? AND organization_id=?", [ids.kien, ids.team]);
    await fixture.restart(); await tick();
    expect((await lifecycleState(fixture, ids.mai)).state).toBe("suspended");
    expect((await lifecycleState(fixture, ids.sam)).state).toBe("deleted");
    expect((await lifecycleState(fixture, ids.alex)).state).toBe("deleted");
    expect(await fixture.runtime.db.get("SELECT error_code FROM managed_lifecycle_results WHERE user_id=?", [ids.mai])).toEqual({ error_code: "LAST_ADMIN" });
    expect(await fixture.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [ids.project])).toEqual({ owner_id: ids.kien, deleted_at: null });
    expect(await fixture.runtime.db.get("SELECT password_hash,managed_by,suspended FROM users WHERE id=?", [ids.sam]))
      .toEqual({ password_hash: null, managed_by: null, suspended: 1 });
    expect(await fixture.runtime.db.get("SELECT id FROM sessions WHERE user_id=?", [ids.sam])).toBeNull();
    expect(await fixture.runtime.db.all("SELECT * FROM billing_accounts WHERE organization_id=?", [other])).toEqual(billing);
    await fixture.restart(); await tick();
    expect((await lifecycleState(fixture, ids.sam)).version).toBe(3);
    const advances = z.array(z.object({ actor_id: IdSchema, target_id: IdSchema })).parse(
      await fixture.runtime.db.all("SELECT actor_id,target_id FROM audit_entries WHERE event='managed.advance' ORDER BY target_id"));
    expect(advances).toHaveLength(2);
    expect(advances.every(entry => entry.actor_id === ids.kien)).toBe(true);
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("MANAGED_HOST_CLOSED", { root, listeners: listeners.size });
}, 180_000);
