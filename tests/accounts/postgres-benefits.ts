import { strict as assert } from "node:assert";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import { applyBillingTransition } from "../../services/accounts/governance";
import { ownerBenefits } from "../../services/accounts/identity/project-benefits";
import { baseFixture } from "../core/base/harness";
import { postgresFixture } from "../core/review/postgres-fixture";
import { fixtureIds as ids, defaultPolicy } from "../fixtures/foundation";

const url = process.env["QUIRE_BENEFITS_POSTGRES_URL"];
if (!url) throw new TypeError("QUIRE_BENEFITS_POSTGRES_URL must name an owned disposable server");
const postgres = await postgresFixture(url);
try {
  await using app = await baseFixture({ createAdapters: postgres.createAdapters });
  assert.equal(app.runtime.db.dialect, "postgres");
  const receipts = await app.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
  const migration = await app.runtime.db.get("SELECT id,digest FROM schema_migrations WHERE id='012-a-project-benefits'");
  assert.deepEqual(migration, { id: "012-a-project-benefits",
    digest: "18928a8f66f1db1293c3d3605d994e09517895a26fad0cb6094d74593037c511" });
  const originalRoles = await app.runtime.db.all("SELECT id,role,version FROM project_members ORDER BY id");
  const operator = await app.login("operator@quire.local");
  const principal = await app.runtime.services.get("identity").require(new Request("http://localhost", { headers: operator.headers }));
  const configure = async (scope: string, benefits: unknown, expectedVersion: number) => app.request(
    `/api/admin/project-benefits/${scope}`, { method: "PUT", headers: operator.headers,
      body: JSON.stringify({ benefits, expectedVersion }) });
  const basic = { compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false };
  const explicit = { ...basic, compileSeconds: 30, writableMembers: 2 };
  const paid = { compileSeconds: 90, writableMembers: 3, historyDays: null, trackChanges: true };
  // Given: actual migrated PostgreSQL storage and deliberately configured finite benefits.
  assert.equal((await configure("deployment/local", basic, 0)).status, 200);
  const access = await app.service.effectiveRole(ids.mai, ids.project);
  assert.equal(access, "viewer");
  const owner = await app.login();
  const reviewer = z.object({ id: IdSchema }).parse(await app.runtime.db.get(
    "SELECT id FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.sam]));
  const selection = await app.request(`/api/projects/${ids.project}/writable-members`, {
    method: "PUT", headers: owner.headers, body: JSON.stringify({ memberIds: [reviewer.id], expectedVersion: 0 }),
  });
  assert.equal(selection.status, 200);
  assert.equal(await app.service.effectiveRole(ids.sam, ids.project), "reviewer");
  assert.equal(await app.service.effectiveRole(ids.mai, ids.project), "viewer");
  assert.deepEqual(await app.runtime.db.all("SELECT id,role,version FROM project_members ORDER BY id"), originalRoles);
  assert.equal((await configure(`user/${ids.kien}`, explicit, 0)).status, 200);
  assert.equal((await configure("plan/manual:deliberate", paid, 0)).status, 200);
  const external = await app.create(owner.headers, "Existing external sponsored project");
  const context = app.service.context;
  // When: real committed billing state changes under the shared account lock.
  const active = await applyBillingTransition(context, principal, {
    organizationId: ids.team, expectedVersion: 0, provider: "manual", planId: "deliberate",
    period: "month", seats: 3, status: "active", renewsAt: null,
  });
  for (const projectId of [ids.project, external.id]) {
    assert.equal((await app.service.policy(ids.mai, projectId)).compileSeconds, 90);
    assert((await app.runtime.events.read(0, { aggregateId: projectId })).some(event =>
      event.topic === "policy.changed" && event.payload.resourceId === projectId));
  }
  assert.deepEqual(await ownerBenefits(context, ids.mai), basic);
  const canceled = await applyBillingTransition(context, principal, {
    organizationId: ids.team, expectedVersion: active.version, provider: "manual", planId: "deliberate",
    period: "month", seats: 3, status: "canceled", renewsAt: null,
  });
  assert.equal(canceled.status, "canceled");
  assert.equal((await app.service.policy(ids.mai, external.id)).compileSeconds, 30);
  assert.equal((await configure(`user/${ids.kien}`, null, 1)).status, 200);
  assert.equal((await configure(`user/${ids.kien}`, explicit, 1)).status, 409);
  // Then: migration receipts, tombstones, and explicit membership selection survive reopen.
  await app.restart();
  assert.deepEqual(await app.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id"), receipts);
  assert.deepEqual(await app.runtime.db.all("SELECT id,role,version FROM project_members ORDER BY id"), originalRoles);
  assert.equal(await app.service.effectiveRole(ids.sam, ids.project), "reviewer");
  assert.equal(await app.service.effectiveRole(ids.mai, ids.project), "viewer");
  const response = await app.request(`/api/projects/${ids.project}/access?branch=main`, { headers: owner.headers });
  const current = z.object({ data: endpoints.accessGet.output }).parse(await response.json()).data;
  assert.deepEqual(current.writableSelection, { memberIds: [reviewer.id], capacity: 1, effectiveCount: 1, selectionRequired: false });
  assert.deepEqual(await app.runtime.db.get(
    "SELECT benefits_json,version FROM account_project_benefits WHERE scope_kind='user' AND scope_id=?", [ids.kien]),
  { benefits_json: null, version: 2 });
  assert.equal((await app.service.policy(ids.mai, ids.project)).compileSeconds, 12);
  assert.equal((await app.runtime.db.all("SELECT policy_json FROM policy_sets")).length, 0);
  assert.deepEqual(await app.runtime.db.get("SELECT policy_json FROM organizations WHERE id=?", [ids.team]),
    { policy_json: JSON.stringify(defaultPolicy) });
  console.info("P4_BENEFITS_POSTGRES_PASS", { migrations: receipts.length, preservedRoles: originalRoles.length,
    selection: reviewer.id, mappedPlanWithdrawn: true, staleResurrectionDenied: true, restart: true });
} finally { await postgres.close(); }
