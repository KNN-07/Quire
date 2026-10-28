import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { DigestSchema } from "@quire/contracts";
import { ControlError, InstallationIdSchema, RoleInventorySchema } from "./model";
import { canonicalJson, controlDigest } from "./protocol";

const pathSchema = z.string().min(1).max(4096).refine(value =>
  isAbsolute(value) && resolve(value) === value && !/[\0\n\r]/.test(value));
const unit = z.string().regex(/^quire-[a-zA-Z0-9_-]+\.service$/).max(200);
export const SystemdDriverConfigSchema = z.strictObject({
  driver: z.literal("systemd-local-v1"),
  installationId: InstallationIdSchema,
  controlRoot: pathSchema, socketRoot: pathSchema, applicationRoot: pathSchema,
  userRuntimeDir: pathSchema, controllerUnit: unit,
  helperUnit: unit,
  maintenanceRoots: z.array(pathSchema).min(1).max(16).readonly(),
  maintenanceSecrets: z.array(pathSchema).max(16).readonly().default([]),
  roleSecrets: z.array(z.strictObject({
    role: z.string().min(1), files: z.array(pathSchema).max(16).readonly(),
  }).readonly()).max(128).readonly().default([]),
  roles: z.array(z.strictObject({
    ...RoleInventorySchema.unwrap().shape,
    unit,
    activators: z.array(z.string().regex(/^quire-[a-zA-Z0-9_-]+\.(socket|timer)$/)).max(16).readonly(),
  }).readonly()).min(1).max(128).readonly(),
  launcher: z.strictObject({ executable: pathSchema, executableDigest: DigestSchema, script: pathSchema, scriptDigest: DigestSchema }).readonly(),
  requestBytes: z.number().int().min(1024).max(1_048_576).default(262144),
  requestTimeoutMs: z.number().int().min(100).max(120000).default(30000),
  execution: z.strictObject({
    root: pathSchema, dockerSocket: pathSchema.optional(),
    maximumConcurrent: z.number().int().min(1).max(16).default(16),
  }).readonly().optional(),
}).readonly();
export type SystemdDriverConfig = z.infer<typeof SystemdDriverConfigSchema>;

export async function privateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 ||
      await realpath(path) !== path) throw new ControlError("CONTROL_PATH_UNSAFE", path);
}
export function below(parent: string, child: string): boolean {
  const name = relative(parent, child);
  return name === "" || (!name.startsWith("..") && !isAbsolute(name));
}
export async function validateDriverConfig(input: unknown): Promise<SystemdDriverConfig> {
  if (z.object({ driver: z.string() }).safeParse(input).data?.driver !== "systemd-local-v1") {
    throw new ControlError("UPDATES_DEPLOYMENT_UNSUPPORTED", "Missing local systemd cohort, launch inhibition, and fresh-store authority");
  }
  const config = SystemdDriverConfigSchema.parse(input);
  for (const root of [config.controlRoot, config.socketRoot, config.applicationRoot, config.userRuntimeDir]) await privateDirectory(root);
  const roots = [config.controlRoot, config.socketRoot, config.applicationRoot];
  if (roots.some((root, i) => roots.some((other, j) => i !== j && below(root, other)))) {
    throw new ControlError("CONTROL_ROOT_OVERLAP");
  }
  if (config.execution) {
    await privateDirectory(config.execution.root);
    if (!below(config.controlRoot, config.execution.root) || config.execution.root === config.controlRoot) {
      throw new ControlError("CONTROL_EXECUTION_ROOT_UNSAFE");
    }
    if (config.execution.dockerSocket) {
      const socket = await lstat(config.execution.dockerSocket);
      if (!socket.isSocket() || await realpath(config.execution.dockerSocket) !== config.execution.dockerSocket) {
        throw new ControlError("CONTROL_DOCKER_UNAVAILABLE");
      }
    }
  }
  const names = [config.controllerUnit, config.helperUnit, ...config.roles.flatMap(role => [role.unit, ...role.activators])];
  const prefix = `quire-${config.installationId}-`;
  if (new Set(names).size !== names.length || names.some(name => !name.startsWith(prefix) || name.startsWith(`${prefix}exec-`))) {
    throw new ControlError("CONTROL_INVENTORY_INVALID");
  }
  for (const root of config.maintenanceRoots) {
    await privateDirectory(root);
    if ([config.controlRoot, config.socketRoot, config.applicationRoot, config.launcher.executable, config.launcher.script]
      .some(protectedPath => below(root, protectedPath) || below(protectedPath, root))) {
      throw new ControlError("CONTROL_ROOT_OVERLAP");
    }
  }
  for (const secret of [...config.maintenanceSecrets, ...config.roleSecrets.flatMap(role => role.files)]) {
    const info = await lstat(secret);
    if (!below(join(config.controlRoot, "secrets"), secret) || !info.isFile() || info.nlink !== 1 ||
        info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || await realpath(secret) !== secret) {
      throw new ControlError("CONTROL_SECRET_UNSAFE");
    }
  }
  for (const [file, digest] of [
    [config.launcher.executable, config.launcher.executableDigest],
    [config.launcher.script, config.launcher.scriptDigest],
  ]) {
    if (file === undefined || digest === undefined) throw new ControlError("CONTROL_CONFIG_INVALID");
    const info = await lstat(file);
    if (!info.isFile() || (info.mode & 0o022) !== 0 || await realpath(file) !== file ||
        below(config.applicationRoot, file) || controlDigest(await readFile(file)) !== digest) {
      throw new ControlError("CONTROL_LAUNCHER_IDENTITY", file);
    }
  }
  return config;
}
export async function loadDriverConfig(path: string): Promise<SystemdDriverConfig> {
  await privateDirectory(dirname(path));
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 262144) {
    throw new ControlError("CONTROL_CONFIG_INVALID");
  }
  const input: unknown = JSON.parse(await readFile(path, "utf8"));
  return validateDriverConfig(input);
}
export function driverInventoryDigest(config: SystemdDriverConfig) {
  return controlDigest(canonicalJson(config.roles));
}
