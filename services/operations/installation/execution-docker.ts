import { z } from "zod";
import { ControlError } from "./model";
import type { ExecutionLaunch, ExecutionTask } from "./execution-model";
import { executionRecipe } from "./execution-recipes";
import { mirrorAddress, validateMirror } from "../environments/inputs";

const containerSchema = z.object({
  Id: z.string().regex(/^[0-9a-f]{64}$/), Name: z.string(),
  Config: z.object({ Labels: z.record(z.string(), z.string()).nullable() }),
  State: z.object({ Running: z.boolean(), Pid: z.number().int().nonnegative(), ExitCode: z.number().int() }),
});
export type OwnedContainer = z.infer<typeof containerSchema>;
/** Register before starting the payload; replay closes the daemon's header/subscription gap. */
export async function observeContainerStart(socket: string, container: string, signal: AbortSignal) {
  const filters = JSON.stringify({ type: ["container"], container: [container], event: ["start"] });
  const response = await fetch(`http://docker/events?since=1&filters=${encodeURIComponent(filters)}`, {
    unix: socket, signal,
  });
  if (!response.ok || !response.body) throw new ControlError("CONTROL_CONTAINER_EVENTS_FAILED");
  const reader = response.body.getReader();
  const started = (async () => {
    let bytes = Buffer.alloc(0);
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) throw new ControlError("CONTROL_CONTAINER_START_UNPROVEN");
        bytes = Buffer.concat([bytes, next.value]);
        if (bytes.byteLength > 65536) throw new ControlError("CONTROL_CONTAINER_EVENTS_LIMIT");
        const newline = bytes.indexOf(10);
        if (newline < 0) continue;
        const event = z.object({ Type: z.literal("container"), Action: z.literal("start"),
          Actor: z.object({ ID: z.string() }) }).parse(JSON.parse(bytes.subarray(0, newline).toString()));
        if (event.Actor.ID !== container) throw new ControlError("CONTROL_CONTAINER_OWNERSHIP_MISMATCH");
        return;
      }
    } finally { await reader.cancel(); }
  })();
  void started.catch(() => undefined);
  return { started };
}
export async function dockerCommand(socket: string, args: readonly string[]) {
  const child = Bun.spawn(["/usr/bin/docker", "--host", `unix://${socket}`, ...args], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LC_ALL: "C" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = [];
    let count = 0;
    const reader = stream.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        count += next.value.byteLength;
        if (count > 1048576) { child.kill("SIGKILL"); throw new ControlError("CONTROL_DOCKER_OUTPUT_LIMIT"); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  try {
    const [stdout, stderr, code] = await Promise.all([collect(child.stdout), collect(child.stderr), child.exited]);
    return { stdout, stderr, code };
  } finally { clearTimeout(timer); }
}
function labels(launch: ExecutionLaunch): Readonly<Record<string, string>> {
  return {
    "quire.installation": launch.installationId, "quire.execution": launch.id,
    "quire.parent": launch.parentExecutionId, "quire.epoch": launch.supervisorEpoch,
    "quire.generation": String(launch.generation),
  };
}
export async function inspectOwnedContainer(socket: string, launch: ExecutionLaunch): Promise<OwnedContainer | null> {
  const name = launch.containerId ?? launch.containerName;
  if (!name) return null;
  const inspected = await dockerCommand(socket, ["container", "inspect", name]);
  if (inspected.code !== 0) {
    if (/No such (object|container):/.test(inspected.stderr)) return null;
    throw new ControlError("CONTROL_DOCKER_UNAVAILABLE", inspected.stderr);
  }
  const container = z.array(containerSchema).length(1).parse(JSON.parse(inspected.stdout))[0];
  if (!container || container.Name !== `/${launch.containerName}` ||
      (launch.containerId !== null && container.Id !== launch.containerId) ||
      Object.entries(labels(launch)).some(([key, value]) => container.Config.Labels?.[key] !== value)) {
    throw new ControlError("CONTROL_CONTAINER_OWNERSHIP_MISMATCH");
  }
  return container;
}
export async function createOwnedContainer(socket: string, launch: ExecutionLaunch, task: ExecutionTask): Promise<string> {
  if (!task.profile.image || !task.source || !launch.containerName) throw new ControlError("CONTROL_DOCKER_PROFILE_REQUIRED");
  const image = await dockerCommand(socket, ["image", "inspect", task.profile.image]);
  if (image.code !== 0) throw new ControlError("CONTROL_DOCKER_IMAGE_UNAVAILABLE", image.stderr);
  const inspected = z.array(z.object({ Id: z.string(), Config: z.object({
    Volumes: z.record(z.string(), z.object({})).nullable().optional(),
  }) })).length(1).parse(JSON.parse(image.stdout))[0];
  if (!inspected || inspected.Id !== task.profile.image) throw new ControlError("CONTROL_DOCKER_IMAGE_UNAVAILABLE");
  const volumes = inspected.Config.Volumes;
  if (volumes && Object.keys(volumes).length) throw new ControlError("CONTROL_IMAGE_VOLUMES_DENIED");
  const build = task.request.work.kind === "environment-build";
  const network: string[] = ["--network=none"];
  if (build) {
    const work = task.request.work;
    if (work.kind !== "environment-build" || !task.profile.mirrors.includes(work.mirror)) throw new ControlError("CONTROL_BUILD_MIRROR_DENIED");
    const mirror = validateMirror(work.mirror);
    if (work.packages.length) {
      const address = await mirrorAddress(mirror);
      network.splice(0, 1, "--network=bridge", "--add-host", `${mirror.hostname}:${address}`);
    }
  }
  const limit = task.request.limits;
  const created = await dockerCommand(socket, [
    "create", "--name", launch.containerName,
    ...Object.entries(labels(launch)).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
    ...network, "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
    ...(build ? ["--user=0:0", "--cap-add=CHOWN", "--cap-add=DAC_OVERRIDE", "--cap-add=FOWNER", "--cap-add=SETUID", "--cap-add=SETGID"] :
      ["--read-only", "--user=65534:65534"]),
    "--pids-limit", String(limit.processes), "--memory", String(limit.memoryBytes),
    "--memory-swap", String(limit.memoryBytes), "--cpus=1", "--ulimit", "nofile=256:256", "--stop-timeout=1",
    "--tmpfs", `/work:rw,nosuid,nodev,size=${limit.workspaceBytes},mode=1777`,
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16777216,mode=1777",
    "--mount", `type=bind,source=${task.source},target=/src,readonly`, "--workdir=/work",
    task.profile.image, ...executionRecipe(task),
  ]);
  if (created.code !== 0) throw new ControlError("CONTROL_CONTAINER_CREATE_FAILED", created.stderr);
  return z.string().regex(/^[0-9a-f]{64}$/).parse(created.stdout);
}
export async function removeOwnedContainer(socket: string, launch: ExecutionLaunch): Promise<number | null> {
  let container = await inspectOwnedContainer(socket, launch);
  if (!container) return null;
  const identified = { ...launch, containerId: container.Id };
  if (container.State.Running) {
    const stopped = await dockerCommand(socket, ["stop", "--time=1", container.Id]);
    if (stopped.code !== 0) throw new ControlError("CONTROL_CONTAINER_STOP_FAILED", stopped.stderr);
    container = await inspectOwnedContainer(socket, identified);
  }
  if (!container || container.State.Running || container.State.Pid !== 0) throw new ControlError("CONTROL_CONTAINER_STOP_UNPROVEN");
  const code = container.State.ExitCode;
  const removed = await dockerCommand(socket, ["rm", "--force", "--volumes", container.Id]);
  if (removed.code !== 0 || await inspectOwnedContainer(socket, identified) !== null) throw new ControlError("CONTROL_CONTAINER_STOP_UNPROVEN");
  return code;
}
export async function publishBuiltImage(socket: string, launch: ExecutionLaunch): Promise<string> {
  const container = await inspectOwnedContainer(socket, launch);
  if (!container || container.State.Running || container.State.ExitCode !== 0 || launch.request.work.kind !== "environment-build") {
    throw new ControlError("CONTROL_BUILD_RESULT_UNPROVEN");
  }
  const result = await dockerCommand(socket, ["commit", "--change", "USER 65534:65534",
    "--change", `LABEL quire.installation=${launch.installationId} quire.execution=${launch.id}`,
    container.Id, `quire-${launch.installationId}-environment:${launch.id}`]);
  if (result.code !== 0) throw new ControlError("CONTROL_BUILD_COMMIT_FAILED", result.stderr);
  return z.string().regex(/^sha256:[0-9a-f]{64}$/).parse(result.stdout);
}
