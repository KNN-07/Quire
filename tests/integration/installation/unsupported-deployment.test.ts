import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

for (const driver of ["docker-compose", "kubernetes-helm"]) {
  test(`production controller rejects ${driver} before opening control or application storage`, async () => {
    const root = await mkdtemp(join(tmpdir(), "quire-installation-unsupported-"));
    try {
      const config = join(root, "installation.json");
      await writeFile(config, JSON.stringify({
        driver: { driver, installationId: "unsupported-owned", controlRoot: join(root, "control"),
          applicationRoot: join(root, "application"), socketRoot: join(root, "sockets") },
      }), { mode: 0o600 });
      const child = Bun.spawn([process.execPath, resolve("apps/server/src/installation-main.ts"), "controller", config], {
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
        env: { ...process.env, QUIRE_DATA_DIR: join(root, "ambient-data"),
          QUIRE_POSTGRES_URL: "postgres://never-open.invalid/unsupported" },
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect(code).not.toBe(0);
      expect(stdout + stderr).toContain("UPDATES_DEPLOYMENT_UNSUPPORTED");
      expect(await readdir(root)).toEqual(["installation.json"]);
    } finally { await rm(root, { recursive: true }); }
  }, 30000);
}
