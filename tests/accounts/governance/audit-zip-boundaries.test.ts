import { expect, test } from "bun:test";
import { OperationSchema } from "@quire/contracts";
import { readZip } from "../../../services/core/base";
import { register as tasks } from "../../../services/operations/tasks";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("audit ZIP denies actual organization members and managers while allowing the independent operator", async () => {
  await using app = await governanceFixture({ core: true });
  tasks({ ...app.runtime, routes: app.runtime.routes.forLane("O") });
  for (const [userId, email, role] of [[ids.mai, "mai@quire.local", "member"], [ids.sam, "sam@quire.local", "manager"]] as const) {
    await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,?,0,?)",
      [crypto.randomUUID(), ids.team, userId, role, app.runtime.clock.now()]);
    const actor = await app.login(email);
    expect((await actor.write(`/api/organizations/${ids.team}/audit/export`)).status).toBe(403);
  }
  const operator = await app.login("operator@quire.local");
  expect(await app.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.team, ids.operator])).toBeNull();
  const response = await operator.write(`/api/organizations/${ids.team}/audit/export`);
  expect(response.status).toBe(202);
  const operation = await data(response, OperationSchema);
  expect(operation.result).toMatchObject({ format: "zip", operatorOnly: false });
  expect((await operator.get(`/api/operations/${operation.id}/download`)).status).toBe(200);
});

test("operator audit ZIP excludes a nonmatching event at the same timestamp", async () => {
  await using app = await governanceFixture({ core: true });
  tasks({ ...app.runtime, routes: app.runtime.routes.forLane("O") });
  const operator = await app.login("operator@quire.local");
  const included = crypto.randomUUID();
  const excluded = crypto.randomUUID();
  for (const [target, event] of [[included, "audit.selected"], [excluded, "audit.excluded"]] as const) {
    await app.runtime.db.run("INSERT INTO audit_entries(id,at,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,'{}')",
      [crypto.randomUUID(), app.runtime.clock.now(), ids.team, event, target]);
  }
  const operation = await data(await operator.write("/api/admin/audit/export", {
    event: "audit.selected", from: app.runtime.clock.now(), to: app.runtime.clock.now(),
  }), OperationSchema);
  expect(operation.result).toMatchObject({ rows: 1, files: 1 });
  const response = await operator.get(`/api/operations/${operation.id}/download`);
  expect(response.status).toBe(200);
  const files = readZip(new Uint8Array(await response.arrayBuffer()));
  expect(files).toHaveLength(1);
  const contents = new TextDecoder().decode(files[0]?.bytes);
  expect(contents).toContain(included);
  expect(contents).not.toContain(excluded);
});
