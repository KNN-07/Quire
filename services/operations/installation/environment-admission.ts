import type { Environment } from "@quire/contracts";
import { defaultLimits } from "../../../workers/compiler/sandbox";
import { profileFor } from "../environments/model";
import type { InstallationRolesSchema } from "./binding";
import type { z } from "zod";

type Roles = z.infer<typeof InstallationRolesSchema>;

/** Read the signed route, not the build ledger: a probe receipt is not a worker grant. */
export function signedEnvironmentAdmission(manifest: Roles, environment: Environment, localRole?: string) {
  const grants = manifest.executionProfiles ?? [];
  if (new Set(grants.map(profile => profile.id)).size !== grants.length) return null;
  if (localRole) {
    if (!manifest.roles.some(role => role.role === localRole && role.kind === "api" &&
      role.compilerBackend === environment.backend)) return null;
    const profiles = grants.filter(profile => profile.backend === environment.backend && profile.roles.includes(localRole) &&
      profile.profile === profileFor(environment) && (environment.backend !== "docker" || profile.image === environment.rootOrImageDigest));
    const kinds = ["compile", "pdf-validate"] as const;
    if (kinds.some(kind => {
      const matches = profiles.filter(profile => profile.kinds.includes(kind));
      const selected = matches[0];
      return matches.length !== 1 || !selected ||
        (["wallSeconds", "memoryBytes", "processes", "workspaceBytes"] as const).some(key =>
          defaultLimits[key] > selected.limits[key]);
    })) return null;
    return { controllerRole: localRole, workerRole: localRole,
      profileIds: profiles.filter(profile => kinds.some(kind => profile.kinds.includes(kind))).map(profile => profile.id) };
  }
  const workerKinds = environment.backend === "docker"
    ? ["compile", "pdf-validate", "environment-metadata", "environment-confinement", "environment-fixture"] as const
    : ["compile", "environment-metadata"] as const;
  for (const controller of manifest.roles.filter(role => role.kind === "worker-controller")) {
    if (!controller.environmentIds?.includes(environment.id) || controller.compilerBackend !== environment.backend) continue;
    const pools = (manifest.executionProfiles ?? []).filter(profile =>
      profile.backend === "worker" && profile.roles.includes(controller.role) && profile.kinds.includes("worker"));
    if (pools.length !== 1) continue;
    const pool = pools[0];
    const worker = manifest.roles.find(role => role.kind === "worker" && role.role === pool?.workerRole);
    if (!worker?.environmentIds?.includes(environment.id) || worker.compilerBackend !== environment.backend ||
        !worker.coordinator || worker.coordinator !== controller.coordinator) continue;
    const profiles = (manifest.executionProfiles ?? []).filter(profile =>
      profile.backend === environment.backend && profile.roles.includes(worker.role) &&
      profile.profile === profileFor(environment) &&
      (environment.backend !== "docker" || profile.image === environment.rootOrImageDigest));
    if (workerKinds.some(kind => {
      const matches = profiles.filter(profile => profile.kinds.includes(kind));
      const selected = matches[0];
      return matches.length !== 1 || !selected ||
        (["wallSeconds", "memoryBytes", "processes", "workspaceBytes"] as const).some(key =>
          defaultLimits[key] > selected.limits[key]);
    })) continue;
    return { controllerRole: controller.role, workerRole: worker.role,
      profileIds: profiles.filter(profile => workerKinds.some(kind => profile.kinds.includes(kind))).map(profile => profile.id) };
  }
  return null;
}
