import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "@quire/runtime";
import { createApplication } from "../../../../apps/server/src/composition";
import type { InstallationBinding } from "../../../../services/operations/installation/model";
import { installationRoleSession } from "../../../../services/operations/installation/launch";

export async function prepareInstallationRole(binding: InstallationBinding) {
  if (binding.data.dialect !== "sqlite") throw new Error("SQLite fixture required");
  const root = binding.data.dataRoot;
  const session = installationRoleSession();
  if (!session) throw new Error("Authenticated installed role required");
  const app = await createApplication({
    config: loadConfig({ QUIRE_DATA_DIR: root, QUIRE_COMPILER_BACKEND: "docker" }),
    startup: "prepared", adapters: {},
  });
  let server: ReturnType<typeof Bun.serve> | undefined;
  return {
    check: () => app.check(),
    async activate() {
      await app.activate();
      server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.fetch(request) });
      await writeFile(join(root, "work", `pandoc-${session.permit.execution.role}.json`),
        JSON.stringify({ url: server.url.href, parent: session.permit.execution.id }));
    },
    async dispose() { await server?.stop(true); await app.dispose(); },
  };
}
