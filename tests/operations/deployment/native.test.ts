import { expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { install } from "../../../scripts/ops/install";
import ky from "ky";
import { checked } from "../../../deploy/runtime/artifacts";

async function launch(prefix: string) {
  const ready = Promise.withResolvers<string>();
  const child = Bun.spawn([join(prefix, "bin/quire"), "serve"], { stdout: "pipe", stderr: "pipe" });
  let output = "";
  const consume = async () => {
    const reader = child.stdout.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        output += new TextDecoder().decode(chunk.value);
        const url = /server.listening[\s\S]*?url: "(http:[^"]+)"/.exec(output)?.[1];
        if (url) ready.resolve(url);
      }
    } finally { reader.releaseLock(); }
  };
  const drain = consume();
  const errors = new Response(child.stderr).text();
  void child.exited.then(async code => ready.reject(new Error(`server exit ${code}: ${await errors}`)));
  const timeout = setTimeout(() => ready.reject(new Error(`startup timeout: ${output}`)), 180_000);
  try {
    const url = await ready.promise;
    return { url, async close() {
      child.kill("SIGTERM");
      const exit = await child.exited;
      await drain;
      expect(exit).toBe(0);
    } };
  } catch (error) {
    child.kill("SIGTERM");
    await child.exited;
    await drain;
    throw error;
  } finally { clearTimeout(timeout); }
}

it("serves production web and durable identity when a native prefix restarts", async () => {
  // Given: a fresh owned installation of the real source and installed packages.
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-deployment-native-"));
  const prefix = join(root, "installation");
  const socket = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = socket.port;
  socket[Symbol.dispose]();
  if (!port) throw new Error("ephemeral port unavailable");
  try {
    await install({ source: resolve("."), prefix, bun: process.execPath, port });
    expect(await checked([join(prefix, "bin/bun"), "--version"])).toBe("1.4.4");
    expect((await stat(join(prefix, "quire.env"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(prefix, "backup-signing.pem"))).mode & 0o777).toBe(0o600);
    const first = await launch(prefix);
    try {
      const page = await ky.get(first.url).text();
      expect(page).toContain('<div id="root">');
      const health = await ky.get(new URL("/api/health", first.url)).json();
      expect(health).toMatchObject({ data: { status: "ok", database: "sqlite" } });
      expect((await ky.get(new URL("/assets/missing.js", first.url), { throwHttpErrors: false })).status).toBe(404);
      expect((await ky.post(new URL("/internal/workers/lease", first.url), {
        json: { workerId: crypto.randomUUID(), environmentIds: ["00000000-0000-4000-8000-000000000030"] },
        throwHttpErrors: false, retry: 0,
      })).status).toBe(401);
      const result = await ky.post(new URL("/api/auth/register", first.url), {
        headers: { origin: `http://127.0.0.1:${port}`, "idempotency-key": crypto.randomUUID() },
        json: { name: "Deployment persistence", email: "owned-deployment@example.invalid", password: "Deployment password 2026!" },
        retry: 0,
      }).json();
      expect(result).toMatchObject({ data: { verificationRequired: true } });
    } finally { await first.close(); }
    // When: the exact same installed prefix is restarted.
    const second = await launch(prefix);
    try {
      const database = new Database(join(prefix, "data/quire.sqlite"), { readonly: true });
      try {
        // Then: the actual HTTP-written identity and migration receipts survive.
        expect(database.query("SELECT name FROM users WHERE primary_email=?").get("owned-deployment@example.invalid"))
          .toEqual({ name: "Deployment persistence" });
        expect(database.query("SELECT COUNT(*) AS count FROM schema_migrations").get())
          .toMatchObject({ count: expect.any(Number) });
      } finally { database.close(); }
      expect((await ky.get(new URL("/api/health", second.url))).status).toBe(200);
    } finally { await second.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 420_000);
