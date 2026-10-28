import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "@quire/runtime";
import { createApplication, modules } from "../../../../apps/server/src/composition";
import { applicationMigrations } from "../../../../apps/server/src/migrations";
import { releaseInventory } from "../../../../services/operations/installation/prepared-storage-host";
import type { InstallationBinding } from "../../../../services/operations/installation/model";

export async function prepareInstallationRole(binding: InstallationBinding) {
  if (binding.data.dialect !== "sqlite") throw new Error("Native fixture release");
  const dataRoot = binding.data.dataRoot;
  const known = new Set((await applicationMigrations()).map(migration => migration.id));
  const extra = (await releaseInventory(binding)).migrations.filter(migration => !known.has(migration.id));
  const app = await createApplication({
    config: loadConfig({ QUIRE_DATA_DIR: dataRoot, QUIRE_COMPILER_BACKEND: "docker" }),
    startup: "prepared", adapters: {}, modules: [...modules, ...(extra.length ? [{
      id: "099-o-p9-schema", lane: "O" as const, order: 999, migrations: extra,
      async register(context: Parameters<(typeof modules)[number]["register"]>[0]) {
        await context.db.get("SELECT value FROM p9_upgrade_probe LIMIT 1");
      },
    }] : [])],
  });
  return {
    async check() {
      const result = await app.check();
      // An actual live-target private filesystem check fails after isolated preflight succeeded.
      if (binding.release.version === "2.0.0" && dataRoot.endsWith("/source")) {
        await readFile(join(dataRoot, "required-candidate-health.dat"));
      }
      return result;
    },
    activate: () => app.activate(), dispose: () => app.dispose(),
  };
}
