import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ControlError } from "./model";
import type { InstallationBinding } from "./model";
import type { ControlledRoleSession } from "./controller-server";
import { canonicalJson } from "./protocol";

const sessionKey = Symbol.for("quire.installation.controlled-role.v1");
type SessionGlobals = typeof globalThis & { [sessionKey]?: ControlledRoleSession };

export function installationRoleSession(): ControlledRoleSession | null {
  const session = (globalThis as SessionGlobals)[sessionKey];
  if (session?.channel.socket.destroyed) throw new ControlError("CONTROL_DISCONNECTED");
  if (!session && (process.env["QUIRE_INSTALLATION_ID"] || process.env["QUIRE_INSTALLATION_SOCKET"])) {
    throw new ControlError("CONTROL_LAUNCH_REQUIRED");
  }
  return session ?? null;
}
/** The stable digest-pinned launcher installs the actual kernel-attested session. */
export async function installationRoleLauncher(socketPath: string): Promise<void> {
  const { connectControlledRole } = await import("./controller-server");
  const session = await connectControlledRole(socketPath);
  Object.defineProperty(globalThis, sessionKey, { value: session, configurable: false, writable: false });
  try {
    if (session.permit.task) {
      const { serveInstallationExecution } = await import("./execution-runner");
      await serveInstallationExecution(session);
    } else {
      const host = await import("./prepared-storage-host");
      if (["ordinary", "prepared"].includes(session.permit.execution.purpose)) await host.serveReleaseRole(session);
      else await host.serveStorageHelper(session);
    }
  } finally { session.channel.close(); }
}
export function controlledRoleBinding(binding: InstallationBinding, role: string): ControlledRoleSession {
  const session = installationRoleSession();
  if (!session || session.channel.socket.destroyed ||
      (session.permit.execution.role !== role && session.permit.execution.purpose !== "preflight") ||
      canonicalJson(session.permit.binding) !== canonicalJson(binding)) throw new ControlError("CONTROL_LAUNCH_REQUIRED");
  return session;
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) return false;
    throw error;
  }
}
/** Runs before storage construction in every direct native/development entrypoint. */
export async function assertUncontrolledEntrypoint(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if ((globalThis as SessionGlobals)[sessionKey] || env["QUIRE_INSTALLATION_ID"] || env["QUIRE_INSTALLATION_SOCKET"]) {
    throw new ControlError("CONTROL_LAUNCH_REQUIRED", "Use the controller-owned role launcher");
  }
  if (await exists(join(resolve(env["QUIRE_DATA_DIR"] ?? ".data"), ".quire-installation.json"))) {
    throw new ControlError("CONTROL_LAUNCH_REQUIRED");
  }
  for (const start of [resolve(env["QUIRE_DATA_DIR"] ?? ".data"), process.cwd(), dirname(resolve(process.argv[1] ?? "."))]) {
    let path = start;
    for (;;) {
      if (await exists(join(path, ".quire-update-root")) || await exists(join(path, ".quire-installation.json"))) {
        throw new ControlError("CONTROL_LAUNCH_REQUIRED");
      }
      const parent = dirname(path);
      if (parent === path) break;
      path = parent;
    }
  }
}
