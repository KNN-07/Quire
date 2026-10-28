import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createApplicationAdapters } from "../../services/adapters";

test("operational migrate and seed CLIs include adapter schemas without registering producers", async () => {
  // Given: a fresh native root and the real exported adapter migration inventory.
  const root = await mkdtemp(join(tmpdir(), "quire-cli-schema-"));
  const data = join(root, "data");
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "git"), "#!/bin/sh\nprintf 'SCHEMA_ONLY_GIT_CALLED\\n' >&2\nexit 73\n", { mode: 0o700 });
  const adapters = createApplicationAdapters({});
  const ids = adapters.modules.flatMap(module => module.migrations?.map(migration => migration.id) ?? []);
  await adapters.close();
  const environment: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test", QUIRE_PROFILE: "local", QUIRE_DATA_DIR: data,
    QUIRE_SEED_PASSWORD: "isolated-cli-seed9!" };
  delete environment["QUIRE_TRANSFER_SOURCE"];
  async function run(script: string, forbidGit: boolean) {
    const child = Bun.spawn([process.execPath, script], {
      cwd: process.cwd(),
      env: { ...environment, ...(forbidGit ? { PATH: `${bin}:${process.env["PATH"] ?? ""}` } : {}) },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(stderr).not.toContain("SCHEMA_ONLY_GIT_CALLED");
  }
  function inspect() {
    const db = new Database(join(data, "quire.sqlite"), { readonly: true });
    try {
      const migrations = z.array(z.object({ id: z.string(), digest: z.string() }))
        .parse(db.query("SELECT id,digest FROM schema_migrations ORDER BY id").all());
      const providers = z.object({ count: z.number() })
        .parse(db.query("SELECT count(*) AS count FROM adapter_provider_configs").get()).count;
      const projects = z.object({ count: z.number() })
        .parse(db.query("SELECT count(*) AS count FROM projects").get()).count;
      return { migrations, providers, projects };
    } finally { db.close(); }
  }
  try {
    // When: schema-only migration runs twice, then the real seed CLI initializes source.
    await run("scripts/migrate.ts", true);
    const first = inspect();
    await run("scripts/migrate.ts", true);
    expect(inspect()).toEqual(first);
    await run("scripts/seed.ts", false);
    const seeded = inspect();
    // Then: every adapter schema is durable, producer configuration remains untouched,
    // and seed uses the same complete inventory rather than a divergent base-only list.
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(first.migrations.some(migration => migration.id === id)).toBe(true);
    expect(first.providers).toBe(0);
    expect(seeded.providers).toBe(0);
    expect(seeded.migrations).toEqual(first.migrations);
    expect(seeded.projects).toBeGreaterThan(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
