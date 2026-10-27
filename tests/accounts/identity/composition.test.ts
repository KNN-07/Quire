import { expect, test } from "bun:test";
import { z } from "zod";
import { AuthOptionsSchema, IdSchema, LinkedIdentitySchema } from "@quire/contracts";
import { createApplication } from "../../../apps/server/src/composition";
import { register, migrations } from "../../../services/accounts/identity";
import { seed } from "../../../scripts/seed";
import { isolatedData } from "../../fixtures/runtime";
import { fixtureIds } from "../../fixtures/foundation";
import { password } from "./harness";

async function composedIdentity() {
  const sandbox = await isolatedData();
  const app = await createApplication({
    config: sandbox.config,
    modules: [{ id: "010-a-identity", lane: "A", order: 10, register, migrations }],
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  return {
    runtime: app.runtime,
    request: (path: string, init: RequestInit = {}) => fetch(new URL(path, server.url), {
      ...init, signal: AbortSignal.timeout(10_000),
    }),
    [Symbol.asyncDispose]: async () => {
      await server.stop(true);
      await app.close();
      await sandbox[Symbol.asyncDispose]();
    },
  };
}

test("registers the public auth options handler through actual application composition", async () => {
  // Given: the real application with the identity module explicitly installed.
  await using app = await composedIdentity();
  // When: an unauthenticated HTTP client requests auth options.
  const response = await app.request("/api/auth/options");
  // Then: the composed route is implemented, with only actual local capabilities.
  expect(response.status).toBe(200);
  expect(z.object({ data: AuthOptionsSchema }).parse(await response.json()).data)
    .toEqual({ passwordEnabled: true, registrationEnabled: true, providers: [] });
});

test("registers caller-scoped persisted linked identity reads through actual application composition", async () => {
  // Given: the composed application, real seed credentials, and two users' persisted identities.
  await using app = await composedIdentity();
  await seed(app.runtime, password);
  const id = IdSchema.parse(crypto.randomUUID());
  const createdAt = app.runtime.clock.now();
  app.runtime.db.query("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)")
    .run(id, fixtureIds.kien, "https://own.example.test", "own-subject", createdAt);
  app.runtime.db.query("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)")
    .run(crypto.randomUUID(), fixtureIds.mai, "https://other.example.test", "other-subject", createdAt);
  const login = await app.request("/api/auth/login", { method: "POST",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ email: "kien@quire.local", password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new TypeError("Composed login did not return a session");
  // When: that authenticated caller requests the actual linked identity endpoint.
  const response = await app.request("/api/me/identities", { headers: { cookie } });
  // Then: the handler is registered and returns only the caller's immutable records.
  expect(response.status).toBe(200);
  expect(response.headers.get("etag")).toBe('"v0"');
  const page = z.object({ data: z.object({ items: z.array(LinkedIdentitySchema), nextCursor: z.string().nullable() }) })
    .parse(await response.json()).data;
  expect(page.items).toEqual([{ id, issuer: "https://own.example.test", subject: "own-subject", createdAt }]);
  expect(page.nextCursor).toBeNull();
});
