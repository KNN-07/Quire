import { expect, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import { reconcileCommandKeys } from "../../../services/operations/updates";
import { requestDigest } from "../../../services/operations/installation/protocol";
import { fixture, id } from "./fixture";
import { rejection } from "./rejection";
import { checkPostgres, postgresFixture } from "./postgres-check";

test("application reservations preserve original identity without an application execution receipt", async () => {
  await using f = await fixture();
  const first = await f.reserve({ key: "reserved-before-accept" });
  expect(await f.runtime.db.all("SELECT * FROM operations WHERE kind='update'")).toEqual([]);
  expect(f.control.get(first.operationId)).toBeNull();
  const retry = await f.reserve({ key: first.key });
  expect(retry).toEqual(first);
  expect(await rejection(f.reserve({ key: first.key, autoSecurity: true }))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const accepted = await f.service.create(retry);
  f.rejectFeed();
  await f.reopenControl();
  const calls = f.feedRequests();
  expect(await f.service.create(await f.reserve({ key: first.key }))).toEqual(accepted);
  expect(f.feedRequests()).toBe(calls);
  expect(await f.runtime.db.all("SELECT * FROM operations WHERE kind='update'")).toEqual([]);
});

test("SQLite enforces cross-kind key conflicts in both insert directions and on operation reassignment", async () => {
  await using f = await fixture();
  const reserved = await f.reserve({ key: "update-first" });
  const insert = (key: string) => f.runtime.db.run(`INSERT INTO operations
    (id,actor_id,kind,status,idempotency_key,created_at,updated_at) VALUES(?,?,'adapter','queued',?,?,?)`,
  [id(), f.actorId, key, f.clock.now(), f.clock.now()]);
  expect(await rejection(insert(reserved.key))).toBeInstanceOf(Error);
  await insert("adapter-first");
  expect(await rejection(f.reserve({ key: "adapter-first" }))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await insert("movable");
  expect(await rejection(f.runtime.db.run(
    "UPDATE operations SET idempotency_key=? WHERE actor_id=? AND idempotency_key='movable'", [reserved.key, f.actorId],
  ))).toBeInstanceOf(Error);
  const results = await Promise.allSettled([insert("concurrent"), f.reserve({ key: "concurrent" })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
});

test("restore reconciliation reserves exact controller identities atomically and cannot resurrect a missing actor", async () => {
  await using f = await fixture();
  const first = await f.reserve();
  await f.runtime.db.run("DELETE FROM o_update_command_keys WHERE operation_id=?", [first.operationId]);
  await reconcileCommandKeys(f.runtime.uow, [first]);
  expect((await f.reserve({ key: first.key })).operationId).toBe(first.operationId);
  const request = { ...first.request, autoSecurity: !first.request.autoSecurity };
  const altered = { ...first, request, requestDigest: requestDigest(request) };
  expect(await rejection(reconcileCommandKeys(f.runtime.uow, [altered]))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const valid = { ...first, key: "new-valid", operationId: id() };
  const missing = { ...first, key: "missing-actor", operationId: id(), actorId: IdSchema.parse(crypto.randomUUID()) };
  expect(await rejection(reconcileCommandKeys(f.runtime.uow, [valid, missing]))).toBeInstanceOf(Error);
  expect(await f.runtime.db.get("SELECT * FROM o_update_command_keys WHERE request_key='new-valid'")).toBeNull();
  expect(await f.runtime.db.get("SELECT id FROM users WHERE id=?", [missing.actorId])).toBeNull();
});

test("PostgreSQL uses real additive triggers and reservations for cross-kind conflicts and offline control replay", async () => {
  await using postgres = await postgresFixture();
  await checkPostgres(postgres.url);
}, 60_000);
