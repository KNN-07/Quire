import { createRuntime, loadConfig } from "@quire/runtime";
import type { RuntimeConfig, ServiceModule } from "@quire/runtime";
import { register as identity, migrations as identityMigrations } from "../../accounts/identity";
import { register as base, migrations as baseMigrations } from "../../core/base";
import { register as git, migrations as gitMigrations, registerCredentials } from "../../core/git";
import { createScaleAdapters } from "../../../apps/server/src/scale";

/** The SSH process owns Git recovery, not API workers, compiler probes or unrelated adapters. */
export const sshModules: readonly ServiceModule[] = [
  { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
  { id: "021-k-base", lane: "K", order: 21, register: base, migrations: baseMigrations },
  { id: "024-k-git", lane: "K", order: 24, register: git, migrations: gitMigrations },
  { id: "025-a-git-credentials", lane: "A", order: 25, register: registerCredentials },
];
export async function createSshRuntime(config: RuntimeConfig = loadConfig()) {
  return createRuntime(config, {
    modules: sshModules,
    ...(config.profile === "scale" ? { createAdapters: createScaleAdapters } : {}),
  });
}
