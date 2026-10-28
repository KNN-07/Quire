import { z } from "zod";
import { IdSchema, InstantSchema, OperationSchema } from "@quire/contracts";
import { join } from "node:path";
import { startInstallationController } from "../../../services/operations/installation/controller";
import { installationRoleLauncher } from "../../../services/operations/installation/launch";
import { installationCredential } from "../../../services/operations/installation/client";
import { createUnixUpdateTransport } from "../../../services/operations/installation/controller-server";
import { InstallationStateSchema, ControlError } from "../../../services/operations/installation/model";
import { signControlCommand } from "../../../services/operations/installation/protocol";
import type { ControlCommand } from "../../../services/operations/installation/protocol";

export async function installationMain(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const [mode, path, credentialPath, installationId, operationId] = args;
  // The host invokes its pinned stable launcher with only the roles socket path.
  if (mode?.startsWith("/") && args.length === 1) return installationRoleLauncher(mode);
  if (mode === "controller" && path && args.length === 2) {
    const controller = await startInstallationController(path);
    const stop = Promise.withResolvers<void>();
    const close = () => stop.resolve();
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
    console.info("installation.controller.ready", { installationId: controller.authority.status().installationId,
      mode: controller.authority.status().mode });
    try { await stop.promise; }
    finally {
      process.off("SIGTERM", close);
      process.off("SIGINT", close);
      await controller.close();
    }
    return;
  }
  if ((mode === "status" || mode === "recover") && path && credentialPath &&
      (mode === "status" ? args.length === 3 : args.length === 5)) {
    const credential = await installationCredential(credentialPath);
    if (credential.channel !== "operator") throw new ControlError("CONTROL_FORBIDDEN");
    const transport = createUnixUpdateTransport(join(path, "control.sock"));
    const send = (command: ControlCommand) => transport.send(signControlCommand({
      protocolVersion: 1, installationId: credential.installationId, credentialId: credential.id,
      requestId: IdSchema.parse(crypto.randomUUID()), issuedAt: InstantSchema.parse(new Date().toISOString()), command,
    }, credential));
    const state = InstallationStateSchema.parse(await send({ method: "status", input: {} }));
    if (mode === "status") {
      const row = state.operationId === null ? null : z.object({ operation: OperationSchema }).nullable()
        .parse(await send({ method: "get", input: { id: state.operationId } }));
      if (state.operationId !== null && row === null) throw new ControlError("CONTROL_RECEIPT_MISSING");
      console.log(JSON.stringify({ installation: state, operation: row?.operation ?? null }));
      return;
    }
    if (installationId !== state.installationId || operationId !== state.operationId) throw new ControlError("CONTROL_RECOVERY_DENIED");
    console.log(JSON.stringify(await send({ method: "recover", input: {
      installationId: state.installationId, operationId: IdSchema.parse(operationId),
      generation: state.generation, supervisorEpoch: state.supervisorEpoch,
    } })));
    return;
  }
  throw new ControlError("CONTROL_ARGUMENTS", "Usage: installation controller <private-config> | status <socket-root> <operator-credential> | recover <socket-root> <operator-credential> <installation-id> <operation-id>");
}
if (import.meta.main) await installationMain(z.array(z.string()).parse(process.argv.slice(2)));
