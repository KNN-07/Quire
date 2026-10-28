import { dirname, join } from "node:path";
import { z } from "zod";
import { ControlError } from "./model";
import { connectControl } from "./controller-server";
import type { ControlledRoleSession } from "./controller-server";
import { ExecutionExitSchema, ExecutionSnapshotSchema } from "./execution-model";
import type { ExecutionSnapshot, InstallationExecutionClient, OwnedExecution } from "./execution-model";
import { signExecutionCommand } from "./execution-protocol";
import type { ExecutionCommand } from "./execution-protocol";
export { describeExecutionSource } from "./execution-source";

export function createInstallationExecutionClient(session: ControlledRoleSession): InstallationExecutionClient {
  if (!session.socketPath) throw new ControlError("CONTROL_EXECUTION_UNAVAILABLE");
  const path = join(dirname(session.socketPath), "executions.sock");
  const send = async (command: ExecutionCommand) => {
    if (session.channel.socket.destroyed) throw new ControlError("CONTROL_DISCONNECTED");
    const channel = await connectControl(path);
    try { return await channel.request("execution", signExecutionCommand(session, command)); }
    finally { channel.close(); }
  };
  return {
    async inspect(id) { return ExecutionSnapshotSchema.parse(await send({ method: "inspect", input: { id } })); },
    async start(request): Promise<OwnedExecution> {
      const initial = ExecutionSnapshotSchema.parse(await send({ method: "start", input: request }));
      const id = initial.launch.id;
      const channel = await connectControl(path);
      const started = Promise.withResolvers<ExecutionSnapshot>();
      const exited = Promise.withResolvers<z.infer<typeof ExecutionExitSchema>>();
      void started.promise.catch(() => undefined);
      void exited.promise.catch(() => undefined);
      let terminal = false;
      const observe = (input: unknown) => {
        const snapshot = ExecutionSnapshotSchema.parse(input);
        if (snapshot.launch.id !== id) throw new ControlError("CONTROL_EXECUTION_RESPONSE_MISMATCH");
        if (snapshot.execution && snapshot.launch.payloadStartedAt !== null) started.resolve(snapshot);
        if (snapshot.launch.result) {
          terminal = true;
          if (!snapshot.execution || snapshot.launch.payloadStartedAt === null) started.reject(new ControlError("CONTROL_EXECUTION_NOT_STARTED"));
          exited.resolve(snapshot.launch.result);
          channel.close();
        }
      };
      channel.handleEvents((topic, input) => {
        if (topic !== "execution") throw new ControlError("CONTROL_EVENT_UNEXPECTED");
        observe(input);
      });
      void channel.closed.then(() => {
        if (!terminal) {
          started.reject(new ControlError("CONTROL_DISCONNECTED"));
          exited.reject(new ControlError("CONTROL_DISCONNECTED"));
        }
      });
      try {
        observe(await channel.request("execution", signExecutionCommand(session, { method: "watch", input: { id } })));
      } catch (error) { channel.close(); throw error; }
      return {
        id, started: started.promise, exited: exited.promise,
        async read(stream, offset, maximumBytes = 32768) {
          const result = z.strictObject({ data: z.base64(), nextOffset: z.number().int().nonnegative(), complete: z.boolean() })
            .parse(await send({ method: "read", input: { id, stream, offset, maximumBytes } }));
          return { bytes: Buffer.from(result.data, "base64"), nextOffset: result.nextOffset, complete: result.complete };
        },
        async stop() { return ExecutionExitSchema.parse(await send({ method: "stop", input: { id } })); },
        async release() { await send({ method: "release", input: { id } }); },
      };
    },
  };
}
