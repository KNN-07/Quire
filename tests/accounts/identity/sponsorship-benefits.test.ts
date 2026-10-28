import { expect, test } from "bun:test";
import { baseFixture } from "../../core/base/harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { ownerBenefits } from "../../../services/accounts/identity/project-benefits";

const basic = { compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false } as const;
test("combines independent licensed sponsorships by maximum and OR without mutual revocation", async () => {
  // Given: two separately licensed organizations with deliberately different mapped benefits.
  await using app = await baseFixture();
  const context = app.service.context;
  await app.runtime.db.run("UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'", [JSON.stringify(basic)]);
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',1,?)",
    [crypto.randomUUID(), ids.institution, ids.kien, context.clock.now()]);
  const first = { compileSeconds: 90, writableMembers: 3, historyDays: null, trackChanges: true };
  const second = { compileSeconds: 120, writableMembers: 2, historyDays: 2, trackChanges: false };
  for (const [organizationId, key, benefits] of [[ids.team, "first", first], [ids.institution, "second", second]] as const) {
    await app.runtime.db.run(`INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
      VALUES('plan',?,?,1,?)`, [`manual:${key}`, JSON.stringify(benefits), context.clock.now()]);
    await app.runtime.db.run(`INSERT INTO billing_accounts(id,organization_id,provider,plan_id,period,seats,status,invoice_email,created_at)
      VALUES(?,?,'manual',?,'month',1,'active','billing@example.test',?)`, [crypto.randomUUID(), organizationId, key, context.clock.now()]);
  }
  // When: the larger history/tracking sponsorship lapses while its independent peer remains active.
  expect(await ownerBenefits(context, ids.kien)).toEqual({ ...first, compileSeconds: 120 });
  await app.runtime.db.run("UPDATE billing_accounts SET status='past_due' WHERE organization_id=?", [ids.team]);
  // Then: only its own contribution disappears; another sponsor remains authoritative.
  expect(await ownerBenefits(context, ids.kien)).toEqual(second);
  await app.runtime.db.run("UPDATE billing_accounts SET status='active',renews_at=NULL WHERE organization_id=?", [ids.team]);
  expect(await ownerBenefits(context, ids.kien)).toEqual({ ...first, compileSeconds: 120 });
  await app.runtime.db.run("UPDATE members SET licensed=0 WHERE organization_id=? AND user_id=?", [ids.institution, ids.kien]);
  expect(await ownerBenefits(context, ids.kien)).toEqual(first);
});
test("does not treat an active personal billing row as an implemented personal checkout entitlement", async () => {
  // Given: a mapped plan and the otherwise-unused nullable personal billing association.
  await using app = await baseFixture();
  const context = app.service.context;
  await app.runtime.db.run("UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'", [JSON.stringify(basic)]);
  await app.runtime.db.run(`INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
    VALUES('plan','configured:personal-price',?,1,?)`, [JSON.stringify({ ...basic, compileSeconds: 300 }), context.clock.now()]);
  await app.runtime.db.run(`INSERT INTO billing_accounts(id,user_id,provider,plan_id,period,seats,status,invoice_email,created_at)
    VALUES(?,?,'configured','personal-price','month',1,'active','billing@example.test',?)`,
  [crypto.randomUUID(), ids.mai, context.clock.now()]);
  // When: the owner resolver evaluates that unimplemented billing dimension.
  const benefits = await ownerBenefits(context, ids.mai);
  // Then: no payment or personal-product contract is inferred from the row.
  expect(benefits).toEqual(basic);
});
