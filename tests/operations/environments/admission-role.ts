import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "@quire/runtime";
import { createApplication, modules } from "../../../apps/server/src/composition";
import type { InstallationBinding } from "../../../services/operations/installation/model";

/** An actual attested fixture role, with an ephemeral HTTP listener for API tests. */
export async function prepareInstallationRole(binding: InstallationBinding, role: string) {
  if (binding.data.dialect !== "sqlite") throw new Error("Expected native admission fixture");
  const dataRoot = binding.data.dataRoot;
  const app = await createApplication({
    config: loadConfig({ QUIRE_DATA_DIR: dataRoot, QUIRE_COMPILER_BACKEND: "docker" }),
    startup: "prepared", adapters: {}, modules,
  });
  let server: ReturnType<typeof Bun.serve> | undefined;
  return {
    check: () => app.check(),
    async activate() {
      await app.activate();
      server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.fetch(request) });
      await writeFile(join(dataRoot, `${role}-admission-url`), server.url.href, { mode: 0o600 });
    },
    async dispose() {
      try { await server?.stop(true); } finally { await app.dispose(); }
    },
  };
}
