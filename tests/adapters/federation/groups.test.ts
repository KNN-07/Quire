import { expect, test } from "bun:test";
import { z } from "zod";
import { fixture } from "./harness";
import { scimSchemas } from "../../../services/adapters/federation/scim-schema";

test("reconciles least privilege and independent licensing when a mapped group changes", async () => {
  // Given
  await using app = await fixture();
  const current = await app.configurations.get();
  await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...current, config: { ...current.config,
    mappings: [{ group: "Researchers", role: "member", ai: "ask" }] } }));
  const headers = await app.token();
  const created = await app.request("/scim/v2/Users", { method: "POST", headers,
    body: JSON.stringify({ schemas: [scimSchemas.Users], externalId: "researcher", userName: "researcher@example.test" }) });
  const user = z.object({ id: z.string() }).parse(await created.json());
  // When
  const group = await app.request("/scim/v2/Groups", { method: "POST", headers,
    body: JSON.stringify({ schemas: [scimSchemas.Groups], externalId: "researchers", displayName: "Researchers", members: [{ value: user.id }] }) });
  // Then
  expect(group.status).toBe(201);
  expect(z.object({ role: z.string(), licensed: z.number() }).parse(await app.runtime.db.get("SELECT role,licensed FROM members WHERE user_id=(SELECT user_id FROM federation_resources WHERE id=?)", [user.id])))
    .toEqual({ role: "member", licensed: 0 });
  const policy = z.object({ policy_json: z.string() }).parse(await app.runtime.db.get("SELECT policy_json FROM policy_sets WHERE scope_kind='federation-user' AND scope_id=(SELECT user_id FROM federation_resources WHERE id=?)", [user.id]));
  expect(JSON.parse(policy.policy_json)).toMatchObject({ ai: "ask" });
});
test("removes mapped access when a SCIM group member is removed", async () => {
  // Given
  await using app = await fixture();
  const current = await app.configurations.get();
  await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...current, config: { ...current.config,
    mappings: [{ group: "Researchers", role: "member", ai: "ask" }] } }));
  const headers = await app.token();
  const user = z.object({ id: z.string() }).parse(await (await app.request("/scim/v2/Users", { method: "POST", headers,
    body: JSON.stringify({ schemas: [scimSchemas.Users], externalId: "researcher", userName: "researcher@example.test" }) })).json());
  const group = z.object({ id: z.string(), meta: z.object({ version: z.string() }) }).parse(await (await app.request("/scim/v2/Groups", { method: "POST", headers,
    body: JSON.stringify({ schemas: [scimSchemas.Groups], externalId: "researchers", displayName: "Researchers", members: [{ value: user.id }] }) })).json());
  // When
  const response = await app.request(`/scim/v2/Groups/${group.id}`, { method: "PATCH", headers: { ...headers, "if-match": group.meta.version },
    body: JSON.stringify({ schemas: [scimSchemas.patch], Operations: [{ op: "remove", path: `members[value eq "${user.id}"]` }] }) });
  // Then
  expect(response.status).toBe(200);
  expect(await app.runtime.db.get("SELECT id FROM members WHERE user_id=(SELECT user_id FROM federation_resources WHERE id=?)", [user.id])).toBeNull();
});
