import { open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { InstallationBinding } from "./model";
import { ControlError } from "./model";
import { handleControl } from "./controller-server";
import type { ControlledLifecycle, ControlledRoleSession } from "./controller-server";
import { ExecutionTaskSchema } from "./execution-model";
import type { ExecutionExit, ExecutionWork } from "./execution-model";
import { nativeExecutionCommand } from "./execution-recipes";
import { releaseInventory } from "./prepared-storage-host";
import { observeContainerStart } from "./execution-docker";

/** The digest-pinned stable launcher dispatches only a controller-issued task here. */
export async function serveInstallationExecution(session: ControlledRoleSession): Promise<void> {
  const task = ExecutionTaskSchema.parse(session.permit.task);
  let started = false;
  let canceled = false;
  let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  let waiter: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  let worker: ControlledLifecycle | undefined;
  let completion: Promise<void> | undefined;
  const eventsAbort = new AbortController();
  const stop = () => { canceled = true; eventsAbort.abort(); child?.kill("SIGTERM"); session.channel.close(); };
  const abort = async (reason: string) => {
    canceled = true;
    await session.channel.request("execution.abort", { token: session.permit.token, reason });
  };
  const run = async (): Promise<void> => {
    const output = await open(join(task.root, "stdout"), "wx", 0o600);
    const errors = await open(join(task.root, "stderr"), "wx", 0o600);
    const result: { code: number | null; stdoutBytes: number; stderrBytes: number } = { code: null, stdoutBytes: 0, stderrBytes: 0 };
    const timer = setTimeout(() => { void abort("wall-limit").catch(() => session.channel.close()); }, task.request.limits.wallSeconds * 1000);
    try {
      if (task.request.work.kind === "worker") {
        await releaseInventory(session.permit.binding);
        const module: unknown = await import(pathToFileURL(resolve(session.permit.binding.release.target,
          session.permit.binding.release.entrypoint)).href);
        const factory = z.object({ prepareInstallationWorker: z.custom<(binding: InstallationBinding,
          request: Extract<ExecutionWork, { kind: "worker" }>) => Promise<ControlledLifecycle>>(value => typeof value === "function") }).parse(module);
        worker = await factory.prepareInstallationWorker(session.permit.binding, task.request.work);
        await worker.check(); await worker.activate();
        await session.channel.request("execution.started", { token: session.permit.token });
        await session.channel.closed;
        result.code = null;
      } else {
        const docker = task.profile.backend === "docker";
        const socket = docker ? z.string().parse(task.dockerSocket) : "";
        const container = docker ? z.string().regex(/^[0-9a-f]{64}$/).parse(task.containerId) : "";
        const observation = docker ? await observeContainerStart(socket, container,
          AbortSignal.any([eventsAbort.signal, AbortSignal.timeout(30000)])) : null;
        const argv = docker ? ["/usr/bin/docker", "--host", `unix://${socket}`, "start", "--attach", container] :
          [...nativeExecutionCommand(task)];
        child = Bun.spawn(argv, { env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C.UTF-8" },
          stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const payload = child;
        let exitCode = payload.exited;
        if (docker) {
          await observation?.started;
          waiter = Bun.spawn(["/usr/bin/docker", "--host", `unix://${socket}`, "wait", container], {
            env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
          });
          const wait = waiter;
          exitCode = Promise.all([wait.exited, new Response(wait.stdout).text(), new Response(wait.stderr).text()])
            .then(([status, stdout, stderr]) => {
              if (status !== 0) throw new ControlError("CONTROL_CONTAINER_WAIT_FAILED", stderr);
              return z.coerce.number().int().nonnegative().parse(stdout.trim());
            });
          void exitCode.catch(() => undefined);
        }
        await session.channel.request("execution.started", { token: session.permit.token });
        const collect = async (stream: ReadableStream<Uint8Array>, file: typeof output, maximum: number) => {
          let count = 0;
          const reader = stream.getReader();
          try { for (;;) {
            const next = await reader.read();
            if (next.done) break;
            const bytes = next.value;
            if (count + bytes.byteLength > maximum) {
              await abort("output-limit");
              throw new ControlError("CONTROL_EXECUTION_OUTPUT_LIMIT");
            }
            let offset = 0;
            while (offset < bytes.byteLength) {
              const written = await file.write(bytes, offset, bytes.byteLength - offset);
              offset += written.bytesWritten;
            }
            count += bytes.byteLength;
          } } finally { reader.releaseLock(); }
          await file.sync();
          return count;
        };
        const [stdoutBytes, stderrBytes, code] = await Promise.all([
          collect(payload.stdout, output, 64 * 1024 * 1024), collect(payload.stderr, errors, 8 * 1024 * 1024), exitCode,
        ]);
        if (docker && await payload.exited !== code) throw new ControlError("CONTROL_CONTAINER_OUTPUT_FAILED");
        Object.assign(result, { stdoutBytes, stderrBytes, code });
      }
    } finally {
      clearTimeout(timer);
      eventsAbort.abort();
      await output.close(); await errors.close();
      await worker?.dispose();
    }
    const exit: ExecutionExit = { id: task.launchId, ...result, canceled, interrupted: false, image: null };
    await session.channel.request("execution.result", { token: session.permit.token, result: exit });
  };
  handleControl(session.channel, async (method, input) => {
    const permit = z.strictObject({ token: z.string(), epoch: IdSchema, generation: z.number().int() }).parse(input);
    if (method !== "execution.start" || started || permit.token !== session.permit.token ||
        permit.epoch !== session.permit.execution.supervisorEpoch || permit.generation !== session.permit.execution.generation) {
      throw new ControlError("CONTROL_EXECUTION_DENIED");
    }
    started = true;
    completion = run();
    void completion.catch(async () => {
      if (!session.channel.socket.destroyed) await abort("runner-failure").catch(() => session.channel.close());
    });
    return { started: true };
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await session.channel.request("ready", { token: session.permit.token });
    await session.channel.closed;
  } finally {
    eventsAbort.abort();
    child?.kill("SIGTERM");
    waiter?.kill("SIGTERM");
    await completion?.catch(() => undefined);
    process.off("SIGTERM", stop); process.off("SIGINT", stop);
  }
}
