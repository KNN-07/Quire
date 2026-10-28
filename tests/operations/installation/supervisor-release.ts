import { loadConfig } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import type { InstallationBinding } from "../../../services/operations/installation/model";

/** Actual release-owned application construction, imported only after a live permit. */
export async function prepareInstallationRole(binding: InstallationBinding, role: string) {
  if (binding.data.dialect !== "sqlite" || role !== "api") throw new Error("Native API proof release only");
  return createApplication({ config: loadConfig({
    QUIRE_DATA_DIR: binding.data.dataRoot, QUIRE_COMPILER_BACKEND: "docker",
  }), startup: "prepared" });
}
