import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { register } from "../../../services/operations/tasks";
import type { UpdateClient } from "../../../services/operations/updates";
import { baseFixture } from "../../core/base/harness";
import { controlFixture } from "../../operations/installation/control-fixture";

const page = z.object({ data: endpoints.operationsList.output });
const operation = z.object({ data: endpoints.operationGet.output });
const orderedId = (value: number) => IdSchema.parse(`00000000-0000-4000-8000-${String(value).padStart(12, "0")}`);
function reader(control: Awaited<ReturnType<typeof controlFixture>>): Pick<UpdateClient, "get" | "list"> {
  // Real durable control rows only; no supervisor or stopped/health fixture is used.
  return {
    get: async id => control.store.get(id),
    list: async query => control.store.list(query),
  };
}
async function applicationRow(app: Awaited<ReturnType<typeof baseFixture>>, id: Id, actorId: Id) {
  await app.runtime.db.run(`INSERT INTO operations
    (id,actor_id,kind,status,progress,result_json,created_at,updated_at)
    VALUES(?,?,'diagnostics','succeeded',1,?,?,?)`,
  [id, actorId, '{"operatorOnly":true}', app.runtime.clock.now(), app.runtime.clock.now()]);
}

test("HTTP operation readers merge persisted control receipts in existing ascending cursor order", async () => {
  await using app = await baseFixture();
  await using control = await controlFixture();
  const owner = await app.login("operator@quire.local");
  const first = { ...control.command("first"), operationId: orderedId(1), actorId: owner.user.id };
  const third = { ...control.command("third"), operationId: orderedId(3), actorId: owner.user.id };
  const firstReceipt = control.store.accept(first, control.release, app.runtime.clock.now());
  control.store.accept(third, control.release, app.runtime.clock.now());
  await applicationRow(app, orderedId(2), owner.user.id);
  control.reopen();
  register({ ...app.runtime, routes: app.runtime.routes.forLane("O") }, reader(control));
  const headers = owner.headers;
  const a = page.parse(await (await app.request("/api/operations?limit=1", { headers })).json()).data;
  expect(a.items.map(row => row.id)).toEqual([first.operationId]);
  expect(a.nextCursor).toBe(first.operationId);
  const b = page.parse(await (await app.request(`/api/operations?limit=1&cursor=${a.nextCursor}`, { headers })).json()).data;
  expect(b.items.map(row => row.id)).toEqual([orderedId(2)]);
  expect(b.nextCursor).toBe(orderedId(2));
  const c = page.parse(await (await app.request(`/api/operations?limit=1&cursor=${b.nextCursor}`, { headers })).json()).data;
  expect(c.items.map(row => row.id)).toEqual([third.operationId]);
  expect(c.nextCursor).toBeNull();
  const filtered = page.parse(await (await app.request("/api/operations?kind=update&status=queued", { headers })).json()).data;
  expect(filtered.items.map(row => row.id)).toEqual([first.operationId, third.operationId]);
  const exact = await app.request(`/api/operations/${first.operationId}`, { headers });
  expect(operation.parse(await exact.json()).data).toEqual(firstReceipt.operation);
  expect(await app.runtime.db.get("SELECT id FROM operations WHERE id=?", [first.operationId])).toBeNull();
});

test("control receipts retain actor ownership and current operator authorization without changing stored results", async () => {
  await using app = await baseFixture();
  await using control = await controlFixture();
  const owner = await app.login("operator@quire.local");
  const outsider = await app.login("outsider@quire.local");
  const command = { ...control.command(), actorId: owner.user.id };
  const accepted = control.store.accept(command, control.release, app.runtime.clock.now());
  register({ ...app.runtime, routes: app.runtime.routes.forLane("O") }, reader(control));
  await app.runtime.db.run("UPDATE users SET operator=1 WHERE id=?", [outsider.user.id]);
  expect((await app.request(`/api/operations/${command.operationId}`, { headers: outsider.headers })).status).toBe(404);
  expect(page.parse(await (await app.request("/api/operations?kind=update", { headers: outsider.headers })).json()).data.items).toEqual([]);
  expect(operation.parse(await (await app.request(`/api/operations/${command.operationId}`, { headers: owner.headers })).json()).data.result)
    .toEqual(accepted.operation.result);
  await app.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [owner.user.id]);
  expect((await app.request(`/api/operations/${command.operationId}`, { headers: owner.headers })).status).toBe(404);
  expect(page.parse(await (await app.request("/api/operations?kind=update", { headers: owner.headers })).json()).data.items).toEqual([]);
  expect(control.store.get(command.operationId)?.operation).toEqual(accepted.operation);
});

test("100-row HTTP pages obtain bounded control lookahead and preserve the final receipt", async () => {
  await using app = await baseFixture();
  await using control = await controlFixture();
  const owner = await app.login("operator@quire.local");
  for (let i = 1; i <= 101; i++) {
    control.store.accept({ ...control.command(`receipt-${i}`), operationId: orderedId(i), actorId: owner.user.id },
      control.release, app.runtime.clock.now());
  }
  register({ ...app.runtime, routes: app.runtime.routes.forLane("O") }, reader(control));
  const first = page.parse(await (await app.request("/api/operations?limit=100", { headers: owner.headers })).json()).data;
  expect(first.items).toHaveLength(100);
  expect(first.items.map(row => row.id)).toEqual(Array.from({ length: 100 }, (_, i) => orderedId(i + 1)));
  expect(first.nextCursor).toBe(orderedId(100));
  const last = page.parse(await (await app.request(`/api/operations?limit=100&cursor=${first.nextCursor}`, { headers: owner.headers })).json()).data;
  expect(last.items.map(row => row.id)).toEqual([orderedId(101)]);
  expect(last.nextCursor).toBeNull();
});

test("conflicting application and control operation IDs fail instead of choosing an authority", async () => {
  await using app = await baseFixture();
  await using control = await controlFixture();
  const owner = await app.login("operator@quire.local");
  const command = { ...control.command(), actorId: owner.user.id };
  control.store.accept(command, control.release, app.runtime.clock.now());
  await applicationRow(app, command.operationId, owner.user.id);
  register({ ...app.runtime, routes: app.runtime.routes.forLane("O") }, reader(control));
  const get = await app.request(`/api/operations/${command.operationId}`, { headers: owner.headers });
  expect(get.status).toBe(409);
  expect(await get.json()).toMatchObject({ error: { code: "OPERATION_ID_CONFLICT" } });
  const list = await app.request("/api/operations", { headers: owner.headers });
  expect(list.status).toBe(409);
  expect(await list.json()).toMatchObject({ error: { code: "OPERATION_ID_CONFLICT" } });
});
