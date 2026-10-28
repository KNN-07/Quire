import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import { createRuntime, SqliteEventPort } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { S3BlobStore } from "../../../services/operations/storage/s3";
import { RemoteBranchCoordinator, RemoteRepositoryService } from "../../../services/operations/repository";
import { register as identity, migrations } from "../../../services/accounts/identity";
import { register } from "../../../services/operations/overview";
import { isolatedData } from "../../fixtures/runtime";

test("real PostgreSQL factory reports injected S3 and remote repositories without claiming provider health", async () => {
  const url = process.env["QUIRE_TEST_POSTGRES_URL"];
  if (!url) throw new Error("QUIRE_TEST_POSTGRES_URL must name an owned disposable PostgreSQL server");
  const admin = await createPostgresStorage({ url });
  const database = `quire_overview_${crypto.randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(url);
  databaseUrl.pathname = `/${database}`;
  await using sandbox = await isolatedData();
  await admin.db.exec(`CREATE DATABASE "${database}"`);
  try {
    const runtime = await createRuntime({ ...sandbox.config, profile: "scale" }, {
      createAdapters: async (_config, clock) => {
        const storage = await createPostgresStorage({ url: databaseUrl.toString() });
        const events = new SqliteEventPort(storage.db, clock);
        // These are the real production clients. No provider is listening at
        // port 1: metadata must not turn their construction into health.
        const options = { url: "http://127.0.0.1:1", token: crypto.randomUUID(), clock };
        const repositories = new RemoteRepositoryService(options);
        const branches = new RemoteBranchCoordinator(options);
        return {
          ...storage, events, repositories, branches,
          blobs: new S3BlobStore({ endpoint: options.url, bucket: "overview",
            region: "us-east-1", accessKeyId: "unavailable", secretAccessKey: "unavailable" }),
          close: async () => {
            await repositories.close();
            await branches.close();
            await events.close();
            await storage.close();
          },
        };
      },
      modules: [
        { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations },
        { id: "040-o-overview", lane: "O", order: 40, register },
      ],
    });
    try {
      const password = "overview-scale-password-2026";
      const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
      const now = runtime.clock.now();
      await runtime.uow.run(async tx => {
        for (const operator of [1, 0]) {
          const id = IdSchema.parse(crypto.randomUUID());
          const email = `overview-${operator}@quire.local`;
          await tx.run("INSERT INTO users(id,name,primary_email,password_hash,operator,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            [id, "Overview user", email, hash, operator, now, now]);
          await tx.run("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)",
            [crypto.randomUUID(), id, email, now]);
        }
      });
      // Metadata has no dependence on the local blobs directory.
      await rm(`${sandbox.path}/blobs`, { recursive: true });
      const login = await runtime.routes.fetch(new Request("http://localhost/api/auth/login", {
        method: "POST", headers: { origin: sandbox.config.publicUrl, "content-type": "application/json" },
        body: JSON.stringify({ email: "overview-1@quire.local", password }),
      }));
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      if (!cookie) throw new Error("Expected authenticated operator cookie");
      const response = await runtime.routes.fetch(new Request("http://localhost/api/admin/overview", { headers: { cookie } }));
      const body: unknown = await response.json();
      if (response.status !== 200) throw new Error(`Overview returned ${response.status}: ${JSON.stringify(body)}`);
      const overview = z.object({ data: endpoints.adminOverview.output }).parse(body).data;
      expect(response.status).toBe(200);
      expect(overview.users).toBe(2);
      expect(overview.projects).toBe(0);
      expect(overview.storageBytes).toBe(0);
      expect(overview.queuedJobs).toBe(0);
      expect(overview.runningJobs).toBe(0);
      expect(overview.topology).toContainEqual({ role: "Database", backend: "PostgreSQL", state: "ready" });
      expect(overview.topology).toContainEqual({ role: "Blobs", backend: "S3-compatible object storage", state: "configured" });
      expect(overview.topology).toContainEqual({ role: "Source repositories", backend: "Remote singleton Git repository service", state: "configured" });
      expect(overview.topology.some(item => /SQLite|Local Git/.test(item.backend))).toBe(false);
      expect(overview.topology.some(item => /worker|Redis/i.test(item.role))).toBe(false);
      expect(overview.capabilities["ai"]?.state).toBe("unconfigured");
    } finally { await runtime.close(); }
  } finally {
    await admin.db.exec(`DROP DATABASE "${database}"`);
    await admin.close();
    console.log(`CLEANED PostgreSQL database ${database}; runtime adapters closed; fixture root disposed`);
  }
}, 30_000);
