import { expect, test } from "bun:test";
import type { ModuleContext } from "@quire/runtime";
import type { ProjectBenefits } from "@quire/contracts";
import { baseFixture } from "../../core/base/harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";
import { benefitsOf, ownerBenefits, projectBenefitCeiling } from "../../../services/accounts/identity/project-benefits";

const basic = { compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false } as const;
const premium = { compileSeconds: 90, writableMembers: 3, historyDays: null, trackChanges: true } as const;
async function grant(context: ModuleContext, input: {
  readonly kind: "deployment" | "user" | "plan"; readonly key: string; readonly benefits: ProjectBenefits | null;
}) {
  await context.db.run(`INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
    VALUES(?,?,?,1,?) ON CONFLICT(scope_kind,scope_id) DO UPDATE SET benefits_json=excluded.benefits_json`,
  [input.kind, input.key, input.benefits === null ? null : JSON.stringify(input.benefits), context.clock.now()]);
}
test("uses the neutral local baseline when commercial configuration is absent", async () => {
  // Given: an existing local deployment and its original policies.
  await using app = await baseFixture();
  // When: a collaborator resolves the current owner's benefits.
  const policy = await app.service.policy(ids.mai, ids.project);
  // Then: no invented paid or hosted Free tier changes the existing deployment.
  expect(benefitsOf(policy)).toEqual(benefitsOf(defaultPolicy));
  expect(await app.runtime.db.all("SELECT scope_kind FROM account_project_benefits")).toEqual([{ scope_kind: "deployment" }]);
});
test("does not invent a 180-second ceiling when no explicit restriction applies", async () => {
  // Given: an external project, an ungrouped owner, and an explicit larger grant.
  await using app = await baseFixture();
  const project = await app.service.create(ids.sam, { name: "Unrestricted grant", origin: { kind: "blank" } });
  await grant(app.service.context, { kind: "deployment", key: "local", benefits: basic });
  await grant(app.service.context, { kind: "user", key: ids.sam, benefits: { ...premium, compileSeconds: 240 } });
  // When: an ungrouped collaborator resolves that project with no policy rows.
  const policy = await app.service.policy(ids.mai, project.id);
  // Then: a fallback default is not silently turned into an explicit restriction.
  expect(policy.compileSeconds).toBe(240);
});
test("retains actor organization JSON ceilings in external owned projects", async () => {
  // Given: the collaborator's institution is separate from the project's workspace.
  await using app = await baseFixture();
  await grant(app.service.context, { kind: "deployment", key: "local", benefits: basic });
  await grant(app.service.context, { kind: "user", key: ids.kien, benefits: premium });
  const project = await app.service.create(ids.kien, { name: "External institution policy", origin: { kind: "blank" } });
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?)",
    [crypto.randomUUID(), ids.institution, ids.mai, app.runtime.clock.now()]);
  await app.runtime.db.run("UPDATE organizations SET policy_json=? WHERE id=?",
    [JSON.stringify({ ...defaultPolicy, compileSeconds: 17, trackChanges: false }), ids.institution]);
  // When: actor and project-wide benefit ceilings are independently resolved.
  const actor = await app.service.policy(ids.mai, project.id);
  const common = await projectBenefitCeiling(app.service.context, project.id);
  // Then: actor organization denial applies without becoming the owner's common grant.
  expect(actor.compileSeconds).toBe(17);
  expect(actor.trackChanges).toBe(false);
  expect(common).toEqual(premium);
});
test("projects owner grants rather than collaborator grants without changing personal policy", async () => {
  // Given: distinct owner and collaborator grants plus nonbinding restriction rows.
  await using app = await baseFixture();
  const context = app.service.context;
  await grant(context, { kind: "deployment", key: "local", benefits: basic });
  await grant(context, { kind: "user", key: ids.kien, benefits: premium });
  await grant(context, { kind: "user", key: ids.mai, benefits: { ...premium, compileSeconds: 150 } });
  const personalBefore = await app.service.policy(ids.mai, ids.project);
  const second = await app.service.create(ids.sam, { name: "Basic-owned", origin: { kind: "blank" } });
  // When: the same actor resolves two differently owned projects.
  const owned = await app.service.policy(ids.mai, ids.project);
  const other = await app.service.policy(ids.mai, second.id);
  // Then: owner projection grants exactly four fields; collaborator wealth is irrelevant.
  expect(benefitsOf(owned)).toEqual(premium);
  expect(benefitsOf(other)).toEqual(basic);
  const { compileSeconds, writableMembers, historyDays, trackChanges, ...personal } = owned;
  expect(personal).toEqual({
    chat: personalBefore.chat, ai: personalBefore.ai, aiDailyUses: personalBefore.aiDailyUses,
    sharing: personalBefore.sharing, anonymousRead: personalBefore.anonymousRead, anonymousEdit: personalBefore.anonymousEdit,
  });
  expect([compileSeconds, writableMembers, historyDays, trackChanges]).toEqual([90, 3, null, true]);
});
for (const kind of ["user", "federation-user", "project", "global", "organization"] as const) {
  test(`retains explicit ${kind} restrictions when the owner grants more`, async () => {
    // Given: a premium owner and a separately persisted explicit ceiling.
    await using app = await baseFixture();
    await grant(app.service.context, { kind: "deployment", key: "local", benefits: basic });
    await grant(app.service.context, { kind: "user", key: ids.kien, benefits: premium });
    const key = kind === "project" ? ids.project : kind === "organization" ? ids.team : ids.mai;
    const ceiling = { ...defaultPolicy, compileSeconds: 20, trackChanges: false };
    await app.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
      VALUES(?,?,?,?,?)`, [crypto.randomUUID(), kind, key, JSON.stringify(ceiling), app.runtime.clock.now()]);
    // When: a collaborator authorizes against that current restriction.
    const result = await app.service.policy(ids.mai, ids.project);
    // Then: grants never bypass denials or rewrite policy rows.
    expect(result.compileSeconds).toBe(20);
    expect(result.trackChanges).toBe(false);
    expect(await app.runtime.db.get("SELECT policy_json FROM policy_sets WHERE scope_kind=? AND scope_id=?", [kind, key]))
      .toEqual({ policy_json: JSON.stringify(ceiling) });
  });
}
test("separates owner restrictions from common project capacity", async () => {
  // Given: an owner-specific seat ceiling lower than their grant.
  await using app = await baseFixture();
  await grant(app.service.context, { kind: "deployment", key: "local", benefits: basic });
  await grant(app.service.context, { kind: "user", key: ids.kien, benefits: premium });
  await app.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
    VALUES(?,'user',?,?,?)`, [crypto.randomUUID(), ids.kien,
    JSON.stringify({ ...defaultPolicy, writableMembers: 0 }), app.runtime.clock.now()]);
  // When: common capacity and another actor's policy are resolved.
  const common = await projectBenefitCeiling(app.service.context, ids.project);
  const actor = await app.service.policy(ids.mai, ids.project);
  // Then: owner restrictions do not silently constrain unrelated actors.
  expect(common.writableMembers).toBe(3);
  expect(actor.writableMembers).toBe(3);
  expect((await app.service.policy(ids.kien, ids.project)).writableMembers).toBe(0);
});
test("retains actor AI consent and allowances when owner benefits change", async () => {
  // Given: actor AI authority differs from the owner's personal denial.
  await using app = await baseFixture();
  const context = app.service.context;
  const unrestricted = { ...defaultPolicy, compileSeconds: 600, ai: "agent", aiDailyUses: null };
  await app.runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify(unrestricted)]);
  for (const [userId, ai, aiDailyUses] of [[ids.mai, "ask", 7], [ids.kien, "off", 0]] as const) {
    await app.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
      VALUES(?,'user',?,?,?)`, [crypto.randomUUID(), userId, JSON.stringify({ ...unrestricted, ai, aiDailyUses }), context.clock.now()]);
  }
  await app.runtime.db.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'fixture',1,?)",
    [ids.mai, context.clock.now()]);
  await grant(context, { kind: "deployment", key: "local", benefits: basic });
  const before = await app.service.policy(ids.mai, ids.project);
  // When: only the project owner's four-field grant grows.
  await grant(context, { kind: "user", key: ids.kien, benefits: premium });
  const after = await app.service.policy(ids.mai, ids.project);
  // Then: actor allowance and consent, not owner's AI denial, remain authoritative.
  expect({ ai: before.ai, uses: before.aiDailyUses }).toEqual({ ai: "ask", uses: 7 });
  expect({ ai: after.ai, uses: after.aiDailyUses }).toEqual({ ai: "ask", uses: 7 });
  expect(benefitsOf(after)).toEqual(premium);
});
test("intersects simultaneous actor and federation ceilings without transplanting owner ceilings", async () => {
  // Given: a premium owner and two distinct actor ceilings.
  await using app = await baseFixture();
  const context = app.service.context;
  await grant(context, { kind: "deployment", key: "local", benefits: basic });
  await grant(context, { kind: "user", key: ids.kien, benefits: premium });
  for (const [kind, compileSeconds] of [["user", 30], ["federation-user", 20]] as const) {
    await app.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
      VALUES(?,?,?,?,?)`, [crypto.randomUUID(), kind, ids.mai,
      JSON.stringify({ ...defaultPolicy, compileSeconds }), context.clock.now()]);
  }
  // When: both independent current restrictions constrain the same actor.
  const result = await app.service.policy(ids.mai, ids.project);
  // Then: neither owner projection nor federation overwrites actor ceilings.
  expect(result.compileSeconds).toBe(20);
  expect((await app.runtime.db.all("SELECT scope_kind FROM policy_sets WHERE scope_id=?", [ids.mai]))).toHaveLength(2);
});
test("combines only active licensed mapped sponsorships and preserves independent grants", async () => {
  // Given: a deliberate manual mapping, explicit grant, and licensed owner.
  await using app = await baseFixture();
  const context = app.service.context;
  await grant(context, { kind: "deployment", key: "local", benefits: basic });
  await grant(context, { kind: "user", key: ids.kien, benefits: { ...basic, compileSeconds: 30 } });
  await grant(context, { kind: "plan", key: "manual:chosen", benefits: premium });
  await app.runtime.db.run("UPDATE members SET licensed=CASE WHEN user_id=? THEN 1 ELSE 0 END", [ids.kien]);
  await app.runtime.db.run(`INSERT INTO billing_accounts(id,organization_id,provider,plan_id,period,seats,status,invoice_email,created_at)
    VALUES(?,?,'manual','chosen','month',3,'active','billing@example.test',?)`, [crypto.randomUUID(), ids.team, context.clock.now()]);
  // When: authoritative billing state or seat allocation changes.
  expect(await ownerBenefits(context, ids.kien)).toEqual(premium);
  expect(await ownerBenefits(context, ids.mai)).toEqual(basic);
  await app.runtime.db.run("UPDATE billing_accounts SET plan_id='unmapped' WHERE organization_id=?", [ids.team]);
  expect((await ownerBenefits(context, ids.kien)).compileSeconds).toBe(30);
  await app.runtime.db.run("UPDATE billing_accounts SET plan_id='chosen' WHERE organization_id=?", [ids.team]);
  await app.runtime.db.run("UPDATE billing_accounts SET status='past_due' WHERE organization_id=?", [ids.team]);
  expect((await ownerBenefits(context, ids.kien)).compileSeconds).toBe(30);
  await app.runtime.db.run("UPDATE billing_accounts SET status='active',renews_at=NULL WHERE organization_id=?", [ids.team]);
  expect(await ownerBenefits(context, ids.kien)).toEqual(premium);
  await app.runtime.db.run("UPDATE members SET licensed=0 WHERE user_id=?", [ids.kien]);
  // Then: withdrawing a sponsorship cannot withdraw the independent user contribution.
  expect((await ownerBenefits(context, ids.kien)).compileSeconds).toBe(30);
});
