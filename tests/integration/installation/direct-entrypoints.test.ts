import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertUncontrolledEntrypoint } from "../../../services/operations/installation/launch";
import { prepareInstallationRole } from "../../../apps/server/src/installation-role";
import { controlFixture } from "../../operations/installation/control-fixture";

test("every direct native role rejects a marked installation before storage despite ambient overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-installation-entrypoints-"));
  try {
    await writeFile(join(root, ".quire-installation.json"), '{"installationId":"owned-entrypoint-proof"}', { mode: 0o600 });
    const commands = [
      ["apps/server/src/main.ts"],
      ["apps/server/src/repository-main.ts"],
      ["scripts/migrate.ts"],
      ["scripts/ops/workers.ts"],
      ["workers/compiler/main.ts"],
      ["scripts/ops/ssh.ts", "serve", join(root, "unopened-client.json")],
    ];
    for (const args of commands) {
      const child = Bun.spawn([process.execPath, ...args.map((arg, i) => i === 0 ? resolve(arg) : arg)], {
        env: { ...process.env, QUIRE_DATA_DIR: root, QUIRE_SECRET_KEY: "a".repeat(64),
          QUIRE_POSTGRES_URL: "postgres://overridden.invalid/never-open",
          QUIRE_WORKER_ENVIRONMENTS_FILE: join(root, "unopened-worker-manifest.json") },
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited,
        new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code).not.toBe(0);
      expect(stdout + stderr).toContain("CONTROL_LAUNCH_REQUIRED");
    }
    expect(await Bun.file(join(root, "quire.sqlite")).exists()).toBe(false);
    expect(await Bun.file(join(root, "secret.key")).exists()).toBe(false);
    expect(await readFile(join(root, ".quire-installation.json"), "utf8")).toBe('{"installationId":"owned-entrypoint-proof"}');
  } finally { await rm(root, { recursive: true }); }
}, 30000);

test("release ancestry denies an ambient alternative data root and explicit uncontrolled development remains available", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-installation-ancestry-"));
  try {
    const release = join(root, "app/releases/prior");
    await mkdir(release, { recursive: true, mode: 0o700 });
    await writeFile(join(root, "app/.quire-update-root"), "ancestry-proof", { mode: 0o600 });
    const child = Bun.spawn([process.execPath, resolve("apps/server/src/main.ts")], {
      cwd: release, env: { ...process.env, QUIRE_DATA_DIR: join(root, "ambient-alternative") },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("CONTROL_LAUNCH_REQUIRED");
    expect(await Bun.file(join(root, "ambient-alternative/quire.sqlite")).exists()).toBe(false);
    await assertUncontrolledEntrypoint({ QUIRE_DATA_DIR: join(root, "explicit-development") });
  } finally { await rm(root, { recursive: true }); }
});

test("calling the signed release factory directly cannot manufacture controller approval", async () => {
  await using control = await controlFixture();
  const failure = await prepareInstallationRole(control.prior, "api").then(() => null, (error: unknown) => error);
  expect(failure).toMatchObject({ code: "CONTROL_LAUNCH_REQUIRED" });
  expect(await Bun.file(join(control.root, "data/prior/quire.sqlite")).exists()).toBe(false);
});
