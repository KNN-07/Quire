import { expect, test } from "bun:test";
import { billingUsageEndpoints } from "../../../packages/contracts/src/routes-billing-usage";
import { billingUsage } from "../../../services/adapters/ai/billing-usage";
import { aiFixture, failure } from "./harness";
import { providerServer } from "./provider";
import { defaultPolicy } from "../../../services/accounts/identity/policy";

test("daily billing usage counts native receipts, scopes allowance, rejects unauthorized projects and resets at UTC midnight", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  await fixture.configure(3);
  const actor = await fixture.login();
  const project = await fixture.project(actor);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await fixture.run(actor, { scope, mode: "ask", tool: "chat", prompt: "Hello", fileIds: [] });
  const read = () => billingUsage(fixture.ai.store, actor.actor, project.id);
  const usage = await read();
  expect(usage.used).toBe(1);
  expect(usage.reserved).toBe(0);
  expect(usage.project?.aiDailyLimit).toBe(3);
  expect(usage.project?.writableMembers).toBeNull();
  expect((await billingUsage(fixture.ai.store, actor.actor)).project).toBeNull();
  const response = await fixture.request(`/api/me/billing-usage?projectId=${project.id}`, { headers: actor.headers });
  expect(response.status).toBe(200);
  expect(billingUsageEndpoints.billingUsageGet.output.parse((await response.json()).data)).toEqual(usage);
  for (const state of ["reserved", "refunded"]) {
    await fixture.runtime.db.run("INSERT INTO ai_usage(id,user_id,day,state,created_at) VALUES(?,?,?,?,?)",
      [crypto.randomUUID(), actor.user.id, usage.day, state, fixture.clock.now()]);
  }
  expect(await read()).toMatchObject({ used: 1, reserved: 1, refunded: 1 });
  const outsider = await fixture.login("operator@quire.local");
  expect(await failure(billingUsage(fixture.ai.store, outsider.actor, project.id))).toMatchObject({ status: 404 });
  await fixture.runtime.db.run("UPDATE policy_sets SET policy_json=? WHERE scope_kind='project' AND scope_id=?",
    [JSON.stringify({ ...defaultPolicy, ai: "agent", aiDailyUses: 0, writableMembers: 0 }), project.id]);
  expect((await read()).project).toMatchObject({ aiDailyLimit: 0, writableMembers: 0 });
  await fixture.restart();
  expect((await read()).used).toBe(1);
  fixture.clock.advance(12 * 60 * 60 * 1000 - 1);
  expect((await read()).used).toBe(1);
  fixture.clock.advance(1);
  expect(await read()).toMatchObject({ used: 0, day: "2026-10-28", resetsAt: "2026-10-29T00:00:00.000Z" });
  await fixture.runtime.db.run("UPDATE policy_sets SET policy_json=? WHERE scope_kind='project' AND scope_id=?",
    [JSON.stringify({ ...defaultPolicy, ai: "off" }), project.id]);
  expect((await read()).project).toMatchObject({ aiDailyLimit: null });
  expect((await read()).project?.aiUnavailable).toContain("denies");
});
