import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { InstallationBinding } from "./model";
import { ControlError } from "./model";
import { below, privateDirectory } from "./driver-config";
import type { SystemdDriverConfig } from "./driver-config";
import { releaseInventory } from "./prepared-storage-host";

export async function installationRuntimeRoot(config: SystemdDriverConfig, binding: InstallationBinding): Promise<string> {
  const data = binding.data;
  const runtimeRoot = data.dialect === "sqlite" ? data.dataRoot : dirname(data.applicationSecretRef);
  await privateDirectory(runtimeRoot);
  const protectedPaths = [config.controlRoot, config.socketRoot, config.applicationRoot,
    config.launcher.executable, config.launcher.script];
  if (protectedPaths.some(path => below(runtimeRoot, path) || below(path, runtimeRoot))) throw new ControlError("CONTROL_ROOT_OVERLAP");
  if (data.dialect === "postgres") {
    await privateDirectory(data.repository.volume);
    if (below(runtimeRoot, data.repository.volume) || below(data.repository.volume, runtimeRoot) ||
        protectedPaths.some(path => below(data.repository.volume, path) || below(path, data.repository.volume))) {
      throw new ControlError("CONTROL_ROOT_OVERLAP");
    }
  }
  await privateDirectory(join(runtimeRoot, "work"));
  return runtimeRoot;
}
export async function assertFreshRuntimeRoot(config: SystemdDriverConfig, binding: InstallationBinding,
  retained: readonly InstallationBinding[]): Promise<void> {
  const root = await installationRuntimeRoot(config, binding);
  if (binding.data.dialect !== "postgres") return;
  const metadata = await lstat(root, { bigint: true });
  for (const prior of retained) {
    if (prior.data.dialect !== "postgres" || prior.data.generationId === binding.data.generationId) continue;
    const other = dirname(prior.data.applicationSecretRef);
    const actual = await lstat(other, { bigint: true });
    if (below(root, other) || below(other, root) || (actual.dev === metadata.dev && actual.ino === metadata.ino)) {
      throw new ControlError("CONTROL_RESTORE_RUNTIME_SHARED");
    }
  }
}
export async function resolveInstallationRoleMounts(config: SystemdDriverConfig, binding: InstallationBinding, role: string) {
  const data = binding.data;
  const runtimeRoot = await installationRuntimeRoot(config, binding);
  const writableRoots = [runtimeRoot];
  const readOnlyFiles: string[] = [];
  if (data.dialect === "postgres") {
    const inventory = await releaseInventory(binding);
    if (!inventory.assets.some(asset => asset.path === "installation-roles.json")) throw new ControlError("CONTROL_ROLE_INVENTORY_REQUIRED");
    const metadata = z.object({ roles: z.array(z.object({ role: z.string(), kind: z.string() })) })
      .parse(JSON.parse(await readFile(join(binding.release.target, "installation-roles.json"), "utf8")));
    const selected = metadata.roles.filter(item => item.role === role);
    if (selected.length !== 1) throw new ControlError("CONTROL_ROLE_UNSUPPORTED");
    if (selected[0]?.kind === "repository") writableRoots.push(data.repository.volume);
    for (const secret of [data.applicationSecretRef, data.database.connectionSecretRef, data.redis.connectionSecretRef,
      data.blobs.credentialsSecretRef, data.repository.credentialsSecretRef]) {
      const info = await lstat(secret);
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 ||
          await realpath(secret) !== secret) throw new ControlError("CONTROL_SECRET_UNSAFE");
      if (below(config.controlRoot, secret) && !config.roleSecrets.some(item => item.role === role && item.files.includes(secret))) {
        throw new ControlError("CONTROL_ROLE_SECRET_REQUIRED");
      }
      readOnlyFiles.push(secret);
    }
  } else {
    readOnlyFiles.push(join(runtimeRoot, "secret.key"));
  }
  return { runtimeRoot, workRoot: join(runtimeRoot, "work"), writableRoots, readOnlyFiles };
}
