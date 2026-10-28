import { loadConfig } from "@quire/runtime";
import { createApplication, modules } from "../../../apps/server/src/composition";
import type { InstallationBinding } from "../../../services/operations/installation/model";

export const candidateMigration = {
  id: "099-o-supervisor-proof",
  sql: "CREATE TABLE supervisor_migration_probe(value TEXT NOT NULL); INSERT INTO supervisor_migration_probe VALUES('migrated');",
};
export async function prepareInstallationRole(binding: InstallationBinding, role: string) {
  if (binding.data.dialect !== "sqlite" || role !== "api") throw new Error("Native API proof release only");
  return createApplication({
    config: loadConfig({ QUIRE_DATA_DIR: binding.data.dataRoot, QUIRE_COMPILER_BACKEND: "docker" }),
    startup: "prepared", adapters: {}, modules: [...modules, {
      id: candidateMigration.id, lane: "O", order: 99, migrations: [candidateMigration],
      async register(context) { await context.db.run("INSERT INTO supervisor_migration_probe VALUES('activated')"); },
    }],
  });
}
