import { expect, test } from "bun:test";
import { baseFixture } from "../../core/base/harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

test("federation ceilings intersect user policy without overwriting either record", async () => {
  await using app = await baseFixture();
  const user = { ...defaultPolicy, compileSeconds: 150, chat: true };
  const federation = { ...defaultPolicy, compileSeconds: 45, chat: false };
  for (const [kind, policy] of [["user", user], ["federation-user", federation]] as const) {
    await app.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
      VALUES(?,?,?,?,?)`, [crypto.randomUUID(), kind, ids.kien, JSON.stringify(policy), app.runtime.clock.now()]);
  }
  const constrained = await app.service.policy(ids.kien, ids.project);
  expect(constrained.compileSeconds).toBe(45);
  expect(constrained.chat).toBe(false);
  await app.runtime.db.run("DELETE FROM policy_sets WHERE scope_kind='federation-user' AND scope_id=?", [ids.kien]);
  expect((await app.service.policy(ids.kien, ids.project)).compileSeconds).toBe(150);
  expect(await app.runtime.db.get<{ policy_json: string }>(
    "SELECT policy_json FROM policy_sets WHERE scope_kind='user' AND scope_id=?", [ids.kien]))
    .toEqual({ policy_json: JSON.stringify(user) });
});
