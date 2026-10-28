import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import { register } from "../../services/operations/tasks";
import { baseFixture } from "../core/base/harness";
import { fixtureIds as ids } from "../fixtures/foundation";

test("operation status is durable, actor-scoped and paged through actual HTTP", async () => {
  await using app = await baseFixture();
  const install = () => register({ ...app.runtime, routes: app.runtime.routes.forLane("O") });
  install();
  const owner = await app.login();
  const outsider = await app.login("outsider@quire.local");
  const exported = await app.request(`/api/projects/${ids.project}/exports`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ kind: "source" }),
  });
  const operation = z.object({ data: endpoints.operationGet.output }).parse(await exported.json()).data;
  await app.restart();
  install();
  const status = await app.request(`/api/operations/${operation.id}`, { headers: owner.headers });
  expect(status.status).toBe(200);
  expect(z.object({ data: endpoints.operationGet.output }).parse(await status.json()).data).toEqual(operation);
  expect((await app.request(`/api/operations/${operation.id}`, { headers: outsider.headers })).status).toBe(404);
  const listed = await app.request("/api/operations?kind=source-export&status=succeeded&limit=1", { headers: owner.headers });
  const page = z.object({ data: endpoints.operationsList.output }).parse(await listed.json()).data;
  expect(page.items.map(item => item.id)).toEqual([operation.id]);
  expect(page.nextCursor).toBeNull();
  expect((await app.request("/api/operations")).status).toBe(401);
});

test("operation status rechecks operator authority and hides demoted results from lists", async () => {
  await using app = await baseFixture();
  register({ ...app.runtime, routes: app.runtime.routes.forLane("O") });
  const operator = await app.login("operator@quire.local");
  const id = IdSchema.parse(crypto.randomUUID());
  await app.runtime.db.run(`INSERT INTO operations(id,actor_id,kind,status,progress,result_json,created_at,updated_at)
    VALUES(?,?,'diagnostics','succeeded',1,?,?,?)`, [id, operator.user.id, JSON.stringify({ operatorOnly: true }),
    app.runtime.clock.now(), app.runtime.clock.now()]);
  expect((await app.request(`/api/operations/${id}`, { headers: operator.headers })).status).toBe(200);
  await app.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [operator.user.id]);
  expect((await app.request(`/api/operations/${id}`, { headers: operator.headers })).status).toBe(403);
  const response = await app.request("/api/operations", { headers: operator.headers });
  expect(z.object({ data: endpoints.operationsList.output }).parse(await response.json()).data.items).toEqual([]);
});
