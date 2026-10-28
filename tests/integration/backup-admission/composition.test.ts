import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import { BranchSchema } from "@quire/contracts";
import { createApplication, modules } from "../../../apps/server/src/composition";
import { superviseEnvironmentWork } from "../../../services/operations/environments/lifecycle";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";
import { origin, peer } from "../../core/review/harness";
import { bounded } from "../portable/process";

test("application shutdown aborts and settles supervised environment cleanup before closing storage", async () => {
  // Given environment work that must finish a durable cleanup after cancellation.
  const root = await mkdtemp(join(tmpdir(), "quire-backup-environment-lifecycle-"));
  const config = loadConfig({ QUIRE_DATA_DIR: root, QUIRE_COMPILER_BACKEND: "docker" });
  const app = await createApplication({ config, modules: modules.map(module => ({ ...module, register: () => undefined })) });
  try {
    await app.runtime.db.exec("CREATE TABLE environment_shutdown_probe(value TEXT)");
    const entered = Promise.withResolvers<void>();
    const work = superviseEnvironmentWork(app.runtime, signal => app.runtime.admission.background(async () => {
      const aborted = new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      entered.resolve();
      await aborted;
      await app.runtime.db.run("INSERT INTO environment_shutdown_probe(value) VALUES('cleaned')");
    }));
    await bounded(entered.promise);
    // When the real application shutdown path runs.
    await bounded(app.close());
    await work;
    // Then the supervisor settled cleanup while its storage was still available.
    const reopened = await createRuntime(config);
    try {
      expect(await reopened.db.get<{ value: string }>("SELECT value FROM environment_shutdown_probe")).toEqual({ value: "cleaned" });
    } finally { await reopened.close(); }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("assembled WebSocket reports maintenance through its real service error protocol", async () => {
  // Given a real application, authenticated session, and network WebSocket.
  const root = await mkdtemp(join(tmpdir(), "quire-backup-websocket-"));
  const app = await createApplication({
    config: loadConfig({ QUIRE_DATA_DIR: root, QUIRE_PUBLIC_URL: origin }),
    modules: modules.map(module => ["010-a-identity", "011-a-governance", "021-k-base", "023-k-review"].includes(module.id)
      ? module : { ...module, register: () => undefined }),
  });
  const server = Bun.serve<RealtimeSocketData>({
    hostname: "127.0.0.1", port: 0, fetch: app.handle, websocket: app.websocket,
  });
  try {
    const password = "quire-admission-websocket";
    await seed(app.runtime, password);
    const login = await app.fetch(new Request(new URL("/api/auth/login", server.url), {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "kien@quire.local", password }),
    }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Actual authenticated cookie required");
    const profile = await app.fetch(new Request(new URL("/api/me", server.url), { headers: { cookie, origin } }));
    const { csrfToken } = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await profile.json()).data;
    await using client = await peer(server.url, {
      projectId: fixtureIds.project, branch: BranchSchema.parse("main"),
    }, { cookie, "x-csrf-token": csrfToken });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const maintenance = app.runtime.admission.exclusive(async () => {
      entered.resolve();
      await release.promise;
    });
    try {
      await bounded(entered.promise);
      // When an actual message arrives after exclusive maintenance has entered.
      const reported = client.next(message => message.type === "error");
      client.send({ type: "presence", fileId: fixtureIds.mainFile, cursor: null, name: "Maintenance probe" });
      const message = await bounded(reported);
      // Then the error is serialized rather than escaping the server callback.
      expect(message.type).toBe("error");
      if (message.type !== "error") throw new Error("Expected maintenance protocol error");
      expect(message.code).toBe("BACKUP_MAINTENANCE");
      expect(client.socket.readyState).toBe(WebSocket.OPEN);
    } finally { release.resolve(); await bounded(maintenance); }
  } finally {
    await server.stop(true);
    await app.close();
    await rm(root, { recursive: true, force: true });
    console.info("ADMISSION_WEBSOCKET_CLEANED", root);
  }
}, 60000);
