import { dirname, join } from "node:path";
import { z } from "zod";
import { IdSchema, InstantSchema } from "@quire/contracts";
import { startInstallationController } from "../../../../services/operations/installation/controller";
import { connectControl, connectControlledRole, handleControl } from "../../../../services/operations/installation/controller-server";
import { serveReleaseRole, serveStorageHelper } from "../../../../services/operations/installation/prepared-storage-host";
import { serveInstallationExecution } from "../../../../services/operations/installation/execution-runner";
import { createInstallationExecutionClient } from "../../../../services/operations/installation/execution-client";
import { ExecutionRequestSchema } from "../../../../services/operations/installation/execution-model";
import type { OwnedExecution } from "../../../../services/operations/installation/execution-model";
import { AcceptedReleaseSchema, ControlError, ReservedUpdateCommandSchema } from "../../../../services/operations/installation/model";
import type { StoppedInstallation } from "../../../../services/operations/installation/model";
import { discover } from "../../../../services/operations/updates/feed";
import { ReportedUpdateFailure } from "../../../../services/operations/updates/model";

const first = z.string().parse(process.argv[2]);
if (first === "controller") {
  const path = z.string().parse(process.argv[3]);
  const harness = z.string().parse(process.argv[4]);
  const controller = await startInstallationController(path);
  const channel = await connectControl(harness, 1048576, 180000);
  let stopped: StoppedInstallation | undefined;
  handleControl(channel, async (method, input) => {
    switch (method) {
      case "state": return controller.authority.status();
      case "records": return { executions: controller.authority.store.executions(), launches: controller.authority.store.executionLaunches() };
      case "stop": {
        const request = z.object({ command: ReservedUpdateCommandSchema, release: AcceptedReleaseSchema }).parse(input);
        const at = InstantSchema.parse(new Date().toISOString());
        controller.authority.store.accept(request.command, request.release, at);
        controller.authority.store.claimDue(at);
        stopped = await controller.authority.stopForUpdate(request.command.operationId);
        return controller.authority.status();
      }
      case "backup":
        if (!stopped) throw new ControlError("TEST_STOPPED_REQUIRED");
        try { return await controller.service.options.storage.backup(stopped); }
        catch (error) {
          if (error instanceof ReportedUpdateFailure) return { failure: error.code, evidence: error.evidence };
          throw error;
        }
      case "update": {
        const request = ReservedUpdateCommandSchema.parse(input);
        const at = InstantSchema.parse(new Date().toISOString());
        const release = (await discover(controller.service.config, at)).find(item => item.id === request.request.releaseId);
        if (!release) throw new ControlError("RELEASE_NOT_FOUND");
        // Scheduling was independently accepted; this case targets actual host execution without a timer delay.
        controller.authority.store.accept(request, release, at);
        await controller.service.tick();
        return controller.authority.store.receipt(request.operationId);
      }
      case "health-proofs":
        return controller.authority.store.executions().flatMap(record => {
          const proof = controller.authority.store.completedHealthFailure(record.identity.id);
          return proof ? [proof] : [];
        });
      default: throw new ControlError("TEST_METHOD_DENIED");
    }
  });
  const stop = () => channel.close();
  process.once("SIGTERM", stop);
  await channel.request("controller-ready", {});
  try { await channel.closed; }
  finally { process.off("SIGTERM", stop); await controller.close(); }
} else {
  const session = await connectControlledRole(first);
  Object.defineProperty(globalThis, Symbol.for("quire.installation.controlled-role.v1"), {
    value: session, configurable: false, writable: false,
  });
  if (session.permit.task) await serveInstallationExecution(session);
  else if (session.permit.execution.purpose !== "ordinary" && session.permit.execution.purpose !== "prepared") {
    await serveStorageHelper(session);
  } else {
    const harness = await connectControl(join(dirname(first), "harness.sock"), 1048576, 180000);
    const client = createInstallationExecutionClient(session);
    const handles = new Map<string, OwnedExecution>();
    handleControl(harness, async (method, input) => {
      if (method === "start") {
        const handle = await client.start(ExecutionRequestSchema.parse(input));
        handles.set(handle.id, handle);
        return { id: handle.id, started: await handle.started };
      }
      const request = z.object({ id: IdSchema, stream: z.enum(["stdout", "stderr"]).optional(),
        offset: z.number().int().nonnegative().optional() }).parse(input);
      const handle = handles.get(request.id);
      if (!handle) throw new ControlError("TEST_EXECUTION_NOT_FOUND");
      if (method === "wait") return handle.exited;
      if (method === "stop") return handle.stop();
      if (method === "release") { await handle.release(); return null; }
      if (method === "read") {
        const chunk = await handle.read(request.stream ?? "stdout", request.offset ?? 0);
        return { ...chunk, bytes: Buffer.from(chunk.bytes).toString("base64") };
      }
      throw new ControlError("TEST_METHOD_DENIED");
    });
    await harness.request("role-ready", { permit: session.permit });
    try { await serveReleaseRole(session); }
    finally { harness.close(); }
  }
}
