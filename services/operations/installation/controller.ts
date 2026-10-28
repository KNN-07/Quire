import { join } from "node:path";
import { open, rename } from "node:fs/promises";
import { z } from "zod";
import { systemClock } from "@quire/runtime";
import { UpdateConfig, UpdateError, UpdateService, startScheduler } from "../updates";
import { SystemdDriverConfigSchema } from "./driver-config";
import { SystemdInstallationAuthority } from "./systemd-authority";
import { InstallationStorageHost } from "./storage";
import { openMaintenanceBinding, StoragePolicySchema } from "./prepared-storage-host";
import { startControllerServer } from "./controller-server";
import { installationCredential, privateInstallationFile } from "./client";
import { ControlError } from "./model";

export const InstallationControllerConfigSchema = z.strictObject({
  driver: SystemdDriverConfigSchema,
  storage: StoragePolicySchema,
  update: UpdateConfig,
  credentials: z.array(z.strictObject({
    path: z.string().startsWith("/"), role: z.string().min(1).nullable(),
  })).min(1).max(129),
});

/** Only this independently supervised process opens control SQL or schedules updates. */
export async function startInstallationController(path: string) {
  const input: unknown = JSON.parse((await privateInstallationFile(path)).toString("utf8"));
  if (!z.object({ driver: z.object({ driver: z.literal("systemd-local-v1") }) }).safeParse(input).success) {
    throw new ControlError("UPDATES_DEPLOYMENT_UNSUPPORTED",
      "Missing local systemd cohort, launch inhibition, and fresh-store authority");
  }
  const config = InstallationControllerConfigSchema.parse(input);
  if (config.update.installId !== config.driver.installationId ||
      config.update.installRoot !== config.driver.applicationRoot) throw new ControlError("CONTROL_BINDING_MISMATCH");
  const credentials = await Promise.all(config.credentials.map(async item => {
    const credential = await installationCredential(item.path);
    if (credential.installationId !== config.driver.installationId ||
        (credential.channel === "operator" ? item.role !== null :
          !config.driver.roles.some(role => role.role === item.role))) throw new ControlError("CONTROL_CREDENTIAL_INVALID");
    return { credential, role: item.role };
  }));
  if (new Set(credentials.map(item => item.credential.id)).size !== credentials.length ||
      !credentials.some(item => item.credential.channel === "operator")) throw new ControlError("CONTROL_CREDENTIAL_INVALID");
  const authority = await SystemdInstallationAuthority.open(config.driver);
  let service: UpdateService | undefined;
  let server: Awaited<ReturnType<typeof startControllerServer>> | undefined;
  let scheduler: ReturnType<typeof startScheduler> | undefined;
  try {
    const storage = new InstallationStorageHost(authority, config.storage);
    service = new UpdateService({
      config: config.update, control: authority.store, authority, storage, clock: systemClock,
      async authorizeActor(actorId) {
        // This is a fresh current-binding connection, never a captured pre-rollback context.
        const opened = await openMaintenanceBinding(authority.status().binding, true);
        try {
          const actor = await opened.context.db.get(
            "SELECT id FROM users WHERE id=? AND operator=1 AND suspended=0 AND deleted_at IS NULL", [actorId]);
          if (!actor) throw new UpdateError("FORBIDDEN", "Scheduling actor is no longer an active operator");
        } finally { await opened.close(); }
      },
    });
    server = await startControllerServer({
      path: join(config.driver.socketRoot, "control.sock"), authority, credentials, service,
    });
    if (authority.status().mode === "open") await authority.startCommittedRoles();
    scheduler = startScheduler(service, error => {
      console.error("installation.update.failed", { code: error instanceof ControlError || error instanceof UpdateError ? error.code : "UPDATE_FAILED" });
    });
    // Observability only: neither launcher nor recovery reads this startup receipt.
    const readyPath = join(config.driver.controlRoot, `.controller-ready-${authority.status().supervisorEpoch}`);
    const ready = await open(readyPath, "wx", 0o600);
    try {
      await ready.writeFile(JSON.stringify({ pid: process.pid, installationId: config.driver.installationId,
        supervisorEpoch: authority.status().supervisorEpoch, generation: authority.status().generation,
        mode: authority.status().mode }));
      await ready.sync();
    } finally { await ready.close(); }
    await rename(readyPath, join(config.driver.controlRoot, "controller-ready.json"));
    const directory = await open(config.driver.controlRoot, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    let closing: Promise<void> | undefined;
    return {
      authority, service,
      close: () => closing ??= (async () => {
        await scheduler?.close();
        await server?.close();
        await service?.close();
        await authority.close();
      })(),
    };
  } catch (error) {
    await scheduler?.close();
    await server?.close();
    await service?.close();
    await authority.close();
    throw error;
  }
}
