import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { createRuntime } from "@quire/runtime";
import { register as identity, migrations } from "../../../services/accounts/identity";
import { register } from "../../../services/operations/overview";
import { isolatedData } from "../../fixtures/runtime";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";

test("reports persisted instance totals only to an authenticated operator", async () => {
  // Given: real native storage, seeded users/projects and the actual overview handler.
  await using sandbox = await isolatedData();
  const runtime = await createRuntime(sandbox.config, { modules: [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations },
    { id: "040-o-overview", lane: "O", order: 40, register },
  ] });
  const password = "overview-test-password-2026";
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    await seed(runtime, password);
    await runtime.uow.run(async tx => {
      for (const [index, status] of ["queued", "queued", "running", "succeeded"].entries()) {
        await tx.run("INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,queued_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?)",
          [crypto.randomUUID(), fixtureIds.kien, fixtureIds.snapshot, fixtureIds.environment,
            "{}", status, runtime.clock.now(), `overview-${index}`]);
      }
      await tx.run("INSERT INTO users(id,name,primary_email,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        [crypto.randomUUID(), "Deleted", "deleted-overview@quire.local", runtime.clock.now(), runtime.clock.now(), runtime.clock.now()]);
    });
    const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => runtime.routes.fetch(request) });
    server = listener;
    const login = async (email: string) => {
      const response = await fetch(new URL("/api/auth/login", listener.url), { method: "POST",
        headers: { origin: sandbox.config.publicUrl, "content-type": "application/json" },
        body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000) });
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (!cookie) throw new TypeError("Expected real session cookie");
      return cookie;
    };
    const operator = await login("operator@quire.local");
    const viewer = await login("alex@quire.local");
    // When: each session reads the same real administration surface.
    const read = (cookie?: string) => fetch(new URL("/api/admin/overview", listener.url), {
      headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(10000),
    });
    const response = await read(operator);
    const overview = z.object({ data: endpoints.adminOverview.output }).parse(await response.json()).data;
    // Then: totals come from persistence, missing services remain unavailable, and reads are privileged.
    expect(response.status).toBe(200);
    expect(overview.users).toBe(6);
    expect(overview.projects).toBe(1);
    expect(overview.storageBytes).toBeGreaterThan(0);
    expect(overview.queuedJobs).toBe(2);
    expect(overview.runningJobs).toBe(1);
    expect(overview.capabilities["compilation"]?.state).toBe("unconfigured");
    expect(overview.capabilities["ai"]?.enabled).toBe(false);
    expect(overview.topology.some(item => item.backend === "SQLite")).toBe(true);
    expect(overview.topology.find(item => item.role === "Blobs")?.state).toBe("configured");
    expect((await read(viewer)).status).toBe(403);
    expect((await read()).status).toBe(401);
  } finally { await server?.stop(true); await runtime.close(); }
});
