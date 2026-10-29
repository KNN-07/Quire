import { z } from "zod";
import { fixture, password } from "./harness";
import { acceptManagement } from "./managed-fixture";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { scimSchemas } from "../../../services/adapters/federation/scim-schema";

export async function releaseFixture() {
  const app = await fixture({ organizationId: ids.team });
  const settings = await app.configurations.get();
  await app.runtime.uow.run(tx => app.configurations.save(tx, { ...settings,
    config: { ...settings.config, mappings: [{ group: "researchers", role: "member", ai: "ask" }] } }));
  const bearer = await app.token();
  const input = { schemas: [scimSchemas.Users], externalId: "release-subject", userName: "release@example.test", active: true };
  const created = await app.request("/scim/v2/Users", { method: "POST", headers: bearer, body: JSON.stringify(input) });
  if (created.status !== 201) throw new TypeError(await created.text());
  const resource = z.object({ id: z.string(), meta: z.object({ version: z.string() }) }).parse(await created.json());
  const group = await app.request("/scim/v2/Groups", { method: "POST", headers: bearer,
    body: JSON.stringify({ schemas: [scimSchemas.Groups], externalId: "release-group", displayName: "researchers", members: [{ value: resource.id }] }) });
  if (group.status !== 201) throw new TypeError(await group.text());
  const groupResource = z.object({ id: z.string(), meta: z.object({ version: z.string() }) }).parse(await group.json());
  app.provider.state.groups = ["researchers"];
  const managed = await acceptManagement(app, resource.id);
  await app.runtime.db.run("UPDATE users SET password_hash=? WHERE id=?",
    [await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }), managed.account.id]);
  const version = z.object({ version: z.number() }).parse(await app.runtime.db.get("SELECT version FROM users WHERE id=?", [managed.account.id]));
  return { ...app, managed, resource, groupResource, bearer, input,
    release: () => app.request(`/api/organizations/${ids.team}/managed/${managed.account.id}/release`, {
      method: "POST", headers: { ...managed.operator.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: version.version }),
    }),
  };
}
export async function releaseSnapshot(app: Awaited<ReturnType<typeof releaseFixture>>) {
  const tables = ["users", "members", "managed_acceptances", "identities", "identity_organization_releases",
    "federation_accounts", "federation_claims", "federation_resources", "federation_members", "policy_sets",
    "projects", "project_members", "events", "audit_entries", "idempotency_results"];
  return Promise.all(tables.map(table => app.runtime.db.all(`SELECT * FROM ${table}`)));
}
