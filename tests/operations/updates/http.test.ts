import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema, ReleaseSchema } from "@quire/contracts";
import { fixture } from "./fixture";

test("returns signed releases and enqueues an authorized update through the real HTTP router", async () => {
  // Given
  await using f = await fixture();
  const list = await f.runtime.routes.fetch(new Request("http://fixture/api/admin/releases", { headers: f.headers }));
  const release = z.object({ data: z.object({ items: z.array(ReleaseSchema) }) }).parse(await list.json()).data.items[0];
  if (!release) throw new TypeError("Missing fixture release");
  // When
  const response = await f.runtime.routes.fetch(new Request("http://fixture/api/admin/updates", {
    method: "POST", headers: f.headers,
    body: JSON.stringify({ releaseId: release.id, at: f.clock.now(), autoSecurity: true }),
  }));
  // Then
  expect(response.status).toBe(202);
  const operation = z.object({ data: OperationSchema, requestId: IdSchema }).parse(await response.json()).data;
  expect(operation.status).toBe("queued");
  await f.service.tick();
  expect((await f.service.store.operation(operation.id)).status).toBe("succeeded");
});

test("rejects an unauthenticated request through the actual HTTP boundary", async () => {
  // Given
  await using f = await fixture();
  // When
  const response = await f.runtime.routes.fetch(new Request("http://fixture/api/admin/releases"));
  // Then
  expect(response.status).toBe(401);
  expect(await f.runtime.db.all("SELECT * FROM o_update_command_keys")).toEqual([]);
});

test("rejects update mutation when its CSRF confirmation is absent", async () => {
  // Given
  await using f = await fixture();
  const headers = new Headers(f.headers);
  headers.delete("x-csrf-token");
  // When
  const response = await f.runtime.routes.fetch(new Request("http://fixture/api/admin/updates", {
    method: "POST", headers, body: JSON.stringify({ releaseId: crypto.randomUUID(), at: f.clock.now(), autoSecurity: false }),
  }));
  // Then
  expect(response.status).toBe(403);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("CSRF_DENIED");
  expect(await f.runtime.db.all("SELECT * FROM o_update_command_keys")).toEqual([]);
});

test("requires recent authentication when accepting a production-shaped update request", async () => {
  // Given
  await using f = await fixture();
  f.advance("2026-10-27T10:16:00.000Z");
  // When
  const response = await f.runtime.routes.fetch(new Request("http://fixture/api/admin/updates", {
    method: "POST", headers: f.headers,
    body: JSON.stringify({ releaseId: crypto.randomUUID(), at: f.clock.now(), autoSecurity: false }),
  }));
  // Then
  expect(response.status).toBe(403);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("FRESH_AUTH_REQUIRED");
  expect(await f.runtime.db.all("SELECT * FROM o_update_command_keys")).toEqual([]);
});

test("rejects a non-operator before forwarding or reserving any command", async () => {
  await using f = await fixture();
  await f.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [f.actorId]);
  const response = await f.runtime.routes.fetch(new Request("http://fixture/api/admin/updates", {
    method: "POST", headers: f.headers,
    body: JSON.stringify({ releaseId: crypto.randomUUID(), at: f.clock.now(), autoSecurity: false }),
  }));
  expect(response.status).toBe(403);
  expect(f.feedRequests()).toBe(0);
  expect(await f.runtime.db.all("SELECT * FROM o_update_command_keys")).toEqual([]);
  expect(f.control.list({ limit: 100 })).toEqual([]);
});

test("the unconfigured API stays honest without starting any controller scheduler", async () => {
  await using f = await fixture("unconfigured");
  const list = await f.runtime.routes.fetch(new Request("http://fixture/api/admin/releases", { headers: f.headers }));
  expect(z.object({ data: z.object({ items: z.array(ReleaseSchema) }) }).parse(await list.json()).data.items).toEqual([]);
  const response = await f.runtime.routes.fetch(new Request("http://fixture/api/admin/updates", {
    method: "POST", headers: f.headers,
    body: JSON.stringify({ releaseId: crypto.randomUUID(), at: f.clock.now(), autoSecurity: false }),
  }));
  expect(response.status).toBe(503);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("UPDATES_UNCONFIGURED");
  expect(await f.runtime.db.all("SELECT * FROM o_update_command_keys")).toEqual([]);
  expect(f.control.list({ limit: 100 })).toEqual([]);
  expect(f.feedRequests()).toBe(0);
});
