import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, resourceVersionTag } from "@quire/contracts";
import { fixture } from "./harness";
import { fixtureIds, defaultPolicy } from "../../fixtures/foundation";

test("takes the least privileged matched group when signed claims name multiple groups", async () => {
  // Given
  await using app = await fixture();
  const settings = await app.configurations.get();
  await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...settings, config: { ...settings.config,
    mappings: [{ group: "Researchers", role: "admin", ai: "agent" }, { group: "Guests", role: "guest", ai: "off" }] } }));
  app.provider.state.groups = ["Researchers", "Guests"];
  const authorization = await app.begin();
  // When
  const response = await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  // Then
  expect(response.status).toBe(303);
  const user = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='external@example.test'"));
  expect(await app.runtime.db.get("SELECT id FROM members WHERE user_id=?", [user.id])).toBeNull();
  expect(z.object({ policy_json: z.string() }).parse(await app.runtime.db.get("SELECT policy_json FROM policy_sets WHERE scope_kind='federation-user' AND scope_id=?", [user.id])).policy_json)
    .toContain('"ai":"off"');
});
test("applies a tighter AI mapping immediately while retaining the independent user policy", async () => {
  // Given
  await using app = await fixture();
  const settings = await app.configurations.get();
  await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...settings, config: { ...settings.config,
    mappings: [{ group: "Researchers", role: "member", ai: "agent" }] } }));
  app.provider.state.groups = ["Researchers"];
  const authorization = await app.begin();
  await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  const user = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='external@example.test'"));
  const independent = JSON.stringify({ ...defaultPolicy, ai: "agent", compileSeconds: 420 });
  await app.runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'user',?,?,?)",
    [crypto.randomUUID(), user.id, independent, app.runtime.clock.now()]);
  await app.runtime.db.run("UPDATE organizations SET policy_json=?", [independent]);
  await app.runtime.db.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'v1',1,?)", [user.id, app.runtime.clock.now()]);
  const operator = await app.login();
  // The independent policy is a ceiling, not a grant of project-owner benefits.
  expect((await app.request(`/api/admin/project-benefits/user/${fixtureIds.kien}`, {
    method: "PUT", headers: operator.headers,
    body: JSON.stringify({ benefits: { compileSeconds: 600, writableMembers: null, historyDays: null, trackChanges: true }, expectedVersion: 0 }),
  })).status).toBe(200);
  const before = await app.runtime.services.get("policy").forProject(user.id, fixtureIds.project);
  expect(before.ai).toBe("agent");
  expect(before.compileSeconds).toBe(420);
  const current = await app.configurations.get();
  const { version, ...draft } = current.config;
  // When
  const response = await app.request("/api/admin/identity", { method: "PUT",
    headers: { ...operator.headers, "if-match": resourceVersionTag(version) },
    body: JSON.stringify({ ...draft, mappings: [{ group: "Researchers", role: "member", ai: "off" }], expectedVersion: version }) });
  // Then
  expect(response.status).toBe(200);
  const policy = await app.runtime.services.get("policy").forProject(user.id, fixtureIds.project);
  expect(policy.ai).toBe("off");
  expect(policy.compileSeconds).toBe(420);
  expect(z.object({ policy_json: z.string() }).parse(await app.runtime.db.get("SELECT policy_json FROM policy_sets WHERE scope_kind='user' AND scope_id=?", [user.id])).policy_json).toBe(independent);
});
