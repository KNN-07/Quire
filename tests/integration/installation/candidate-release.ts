import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { InstallationBinding } from "../../../services/operations/installation/model";
import { controlledRoleBinding } from "../../../services/operations/installation/launch";
import { connectControl } from "../../../services/operations/installation/controller-server";
import type { ControlChannel } from "../../../services/operations/installation/controller-server";
import { prepareInstallationRole as prepareActualRole } from "../../../apps/server/src/installation-role";
export { prepareInstallationWorker } from "../../../apps/server/src/installation-role";

/** Real signed candidate factory with an IPC barrier after actual prepared health. */
export async function prepareInstallationRole(binding: InstallationBinding, role: string) {
  const lifecycle = await prepareActualRole(binding, role);
  const session = controlledRoleBinding(binding, role);
  let barrier: ControlChannel | undefined;
  return {
    async check() {
      const readiness = await lifecycle.check();
      if (session.permit.execution.purpose === "prepared" && role === "api-a") {
        const input: unknown = JSON.parse(await readFile(join(binding.release.target, "installation-health.json"), "utf8"));
        const config = z.strictObject({ socket: z.string().startsWith("/") }).parse(input);
        barrier = await connectControl(config.socket);
        try {
          await barrier.request("prepared-health-ready", {
            execution: session.permit.execution, binding, readiness, pid: process.pid,
          });
        } finally { barrier.close(); }
      }
      return readiness;
    },
    activate: () => lifecycle.activate(),
    async dispose() { barrier?.close(); await lifecycle.dispose(); },
  };
}
