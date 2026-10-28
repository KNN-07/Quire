import { mkdir, cp } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { Migration } from "@quire/contracts";

type BaselineRuntime = { readonly db: Database; readonly close: () => void };
type BaselineModule = { readonly id: string; readonly lane: string; readonly order: number; readonly migrations?: readonly Migration[] };

// Run with an extracted, unmodified 3fe3a23 tree; never point at user data.
const root = process.argv[2];
const output = process.argv[3];
if (!root || !output) throw new Error("Expected isolated baseline root and fixture output");
const dataDir = join(root, "fixture-data");
await mkdir(dataDir, { recursive: true });
const { createRuntime }: {
  createRuntime: (config: unknown, options: { modules: readonly BaselineModule[] }) => Promise<BaselineRuntime>;
} = await import(join(root, "packages/runtime/src/context.ts"));
const { loadConfig }: { loadConfig: (env: Readonly<Record<string, string>>) => unknown } =
  await import(join(root, "packages/runtime/src/config.ts"));
const { seed }: { seed: (runtime: BaselineRuntime, password: string) => Promise<unknown> } =
  await import(join(root, "scripts/seed.ts"));
const { modules }: { modules: readonly BaselineModule[] } = await import(join(root, "apps/server/src/composition.ts"));
const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: dataDir }), {
  modules: modules.map((module) => ({
    ...module, register: () => undefined,
  })),
});
try {
  await seed(runtime, "portable-baseline-password");
  console.info(JSON.stringify({
    baseline: "3fe3a235aaf7495af5471e2f2c72f95f4c7485cd",
    migrations: runtime.db.query("SELECT id,digest,applied_at FROM schema_migrations ORDER BY id").all(),
    users: runtime.db.query("SELECT COUNT(*) AS count FROM users").get(),
    projects: runtime.db.query("SELECT id,name FROM projects").all(),
  }, null, 2));
  console.info("baseline.checkpoint", runtime.db.query("PRAGMA wal_checkpoint(TRUNCATE)").get());
} finally { runtime.close(); }
await cp(join(dataDir, "quire.sqlite"), output);
const fixture = new Database(output, { readonly: true });
try {
  console.info("fixture.integrity", fixture.query("PRAGMA integrity_check").get());
  const migrations = fixture.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schema_migrations").get();
  const users = fixture.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM users").get();
  if (migrations?.count !== 12 || users?.count !== 6) throw new Error("Incomplete baseline fixture");
  console.info("fixture.verified", { migrations: migrations.count, users: users.count });
} finally { fixture.close(); }
