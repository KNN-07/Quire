import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { IdSchema, InstantSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ControlError } from "./model";
import type { ExecutionIdentity, InstallationBinding } from "./model";
import { below } from "./driver-config";
import { canonicalJson, controlDigest } from "./protocol";
import { ExecutionEnvelopeSchema } from "./execution-protocol";
import { ExecutionExitSchema, ExecutionProfileSchema, ExecutionRequestSchema } from "./execution-model";
import type { ExecutionExit, ExecutionLaunch, ExecutionSnapshot, ExecutionTask } from "./execution-model";
import { handleControl, listenControl } from "./controller-server";
import type { ControlChannel } from "./controller-server";
import { releaseInventory } from "./prepared-storage-host";
import { removeExecutionFiles, sealExecutionSource } from "./execution-source";
import { createOwnedContainer, inspectOwnedContainer, publishBuiltImage, removeOwnedContainer } from "./execution-docker";
import type { SystemdInstallationAuthority } from "./systemd-authority";

const now = () => InstantSchema.parse(new Date().toISOString());
const terminal = (launch: ExecutionLaunch) => ["exited", "interrupted", "released"].includes(launch.state);
export class InstallationExecutionBroker {
  private readonly tasks = new Map<Id, Promise<void>>();
  private readonly aborts = new Map<Id, AbortController>();
  private readonly stopping = new Map<Id, Promise<ExecutionExit>>();
  private readonly watchers = new Map<Id, Set<ControlChannel>>();
  private transport: Awaited<ReturnType<typeof listenControl>> | undefined;
  private closing = false;
  constructor(readonly authority: SystemdInstallationAuthority) {}
  private get store() { return this.authority.store; }
  async listen(): Promise<void> {
    const path = join(this.authority.config.socketRoot, "executions.sock");
    await this.authority.prepareExecutionSocket(path);
    this.transport = await listenControl(path, (channel, peer) => {
      handleControl(channel, async (method, input) => {
        if (method !== "execution") throw new ControlError("CONTROL_METHOD_DENIED");
        const parsed = ExecutionEnvelopeSchema.parse(input);
        const parent = await this.authority.authenticateExecutionPeer(peer, parsed);
        const command = parsed.command;
        if (command.method === "start") return this.start(parent.execution, parent.binding, command.input);
        const launch = this.store.executionLaunch(command.input.id);
        if (!launch || launch.parentExecutionId !== parent.execution.id) throw new ControlError("CONTROL_EXECUTION_FORBIDDEN");
        switch (command.method) {
          case "inspect": return this.snapshot(launch.id);
          case "watch": {
            const watchers = this.watchers.get(launch.id) ?? new Set<ControlChannel>();
            watchers.add(channel); this.watchers.set(launch.id, watchers);
            void channel.closed.then(() => {
              watchers.delete(channel);
              if (!watchers.size) this.watchers.delete(launch.id);
            });
            return this.snapshot(launch.id);
          }
          case "stop": return this.stop(launch.id, true);
          case "read": return this.read(launch, command.input.stream, command.input.offset, command.input.maximumBytes);
          case "release":
            if (!terminal(launch)) throw new ControlError("CONTROL_EXECUTION_NOT_STOPPED");
            await removeExecutionFiles(launch.root);
            this.store.executionLaunchState(launch.id, "released");
            return null;
        }
        throw new ControlError("CONTROL_METHOD_DENIED");
      });
    }, this.authority.config.requestBytes, this.authority.config.requestTimeoutMs);
  }
  snapshot(id: Id): ExecutionSnapshot {
    const launch = this.store.executionLaunch(id);
    if (!launch) throw new ControlError("CONTROL_EXECUTION_NOT_FOUND");
    return { launch, execution: this.store.executions().find(row => row.identity.id === launch.executionId)?.identity ?? null,
      pid: launch.executionId ? this.authority.executionPid(launch.executionId) : null };
  }
  private publish(id: Id): void {
    const snapshot = this.snapshot(id);
    for (const channel of this.watchers.get(id) ?? []) {
      try { channel.notify("execution", snapshot); } catch { channel.close(); }
    }
  }
  private async profile(binding: InstallationBinding, profileId: string) {
    const inventory = await releaseInventory(binding);
    if (!inventory.assets.some(asset => asset.path === "installation-roles.json")) throw new ControlError("CONTROL_EXECUTION_PROFILE_REQUIRED");
    const manifest = z.object({ installationId: z.string(),
      executionProfiles: z.array(ExecutionProfileSchema).min(1).max(128) })
      .parse(JSON.parse(await readFile(join(binding.release.target, "installation-roles.json"), "utf8")));
    if (manifest.installationId !== this.authority.config.installationId ||
        new Set(manifest.executionProfiles.map(item => item.id)).size !== manifest.executionProfiles.length) {
      throw new ControlError("CONTROL_EXECUTION_PROFILE_INVALID");
    }
    const selected = manifest.executionProfiles.find(item => item.id === profileId || item.image === profileId);
    if (selected) return selected;
    // An immutable image is admitted only when this installation actually built it.
    const built = this.store.executionLaunches().find(launch => launch.result?.image === profileId &&
      launch.result.code === 0 && !launch.result.interrupted && launch.request.work.kind === "environment-build");
    const inherited = built && manifest.executionProfiles.find(item => item.id === built.profile.id);
    if (!built || !inherited || !built.result?.image) throw new ControlError("CONTROL_EXECUTION_PROFILE_REQUIRED");
    return ExecutionProfileSchema.parse({ ...inherited, image: built.result.image });
  }
  private async start(parent: ExecutionIdentity, binding: InstallationBinding, input: unknown): Promise<ExecutionSnapshot> {
    const config = this.authority.config.execution;
    if (!config || this.closing) throw new ControlError("CONTROL_EXECUTION_UNAVAILABLE");
    const request = ExecutionRequestSchema.parse(input);
    const digest = controlDigest(canonicalJson(request));
    const old = this.store.executionLaunches().find(launch =>
      launch.parentExecutionId === parent.id && launch.request.requestId === request.requestId);
    if (old) {
      if (old.requestDigest !== digest) throw new ControlError("CONTROL_EXECUTION_CONFLICT");
      return this.snapshot(old.id);
    }
    const profile = await this.profile(binding, request.profileId);
    if (!profile.roles.includes(parent.role) || !profile.kinds.includes(request.work.kind) ||
        request.limits.wallSeconds > profile.limits.wallSeconds || request.limits.memoryBytes > profile.limits.memoryBytes ||
        request.limits.processes > profile.limits.processes || request.limits.workspaceBytes > profile.limits.workspaceBytes ||
        (request.work.kind === "worker") !== (profile.backend === "worker") ||
        (profile.backend === "worker" && !profile.workerRole) ||
        (profile.backend === "docker" && (!profile.image || !config.dockerSocket))) {
      throw new ControlError("CONTROL_EXECUTION_POLICY_DENIED");
    }
    const active = this.store.executionLaunches().filter(launch => !terminal(launch));
    if (active.length >= config.maximumConcurrent || active.filter(launch => launch.profile.id === profile.id).length >= profile.maxConcurrent) {
      throw new ControlError("CONTROL_EXECUTION_LIMIT");
    }
    if ("source" in request.work) {
      const runtimeRoot = binding.data.dialect === "sqlite" ? binding.data.dataRoot : dirname(binding.data.applicationSecretRef);
      const workRoot = join(runtimeRoot, "work");
      if (!below(workRoot, request.work.source.path) || request.work.source.path === workRoot) throw new ControlError("CONTROL_EXECUTION_SOURCE_INVALID");
    }
    const id = IdSchema.parse(crypto.randomUUID());
    if (this.closing) throw new ControlError("CONTROL_EXECUTION_UNAVAILABLE");
    const state = this.authority.status();
    const launch = this.store.reserveExecutionLaunch({
      id, parentExecutionId: parent.id, installationId: state.installationId,
      supervisorEpoch: state.supervisorEpoch, generation: state.generation, binding,
      request, requestDigest: digest, profile, unit: `quire-${state.installationId}-exec-${id}.service`,
      root: join(config.root, id), containerName: profile.backend === "docker" ? `quire-${state.installationId}-exec-${id}` : null,
      containerId: null, executionId: null, createdAt: now(), payloadStartedAt: null, state: "reserved", result: null, report: null,
    });
    if (launch.id !== id) return this.snapshot(launch.id);
    const abort = new AbortController(); this.aborts.set(id, abort);
    const task = this.run(launch, abort.signal);
    this.tasks.set(id, task);
    void task.catch(async error => {
      try { await this.stop(id, false); }
      catch (stopError) {
        const operationId = this.authority.status().operationId;
        if (operationId) this.store.requireRecovery(operationId, "CONTROL_EXECUTION_STOP_UNPROVEN", now());
        console.error("installation.execution.stop.failed", id, error, stopError);
      }
    }).finally(() => this.tasks.delete(id));
    return this.snapshot(id);
  }
  private async run(launch: ExecutionLaunch, signal: AbortSignal): Promise<void> {
    await mkdir(launch.root, { mode: 0o700 });
    const task: ExecutionTask = {
      launchId: launch.id, request: launch.request, profile: launch.profile, root: launch.root,
      source: "source" in launch.request.work ? join(launch.root, "source") : null,
      containerId: null, dockerSocket: this.authority.config.execution?.dockerSocket ?? null,
    };
    await sealExecutionSource(task, signal);
    signal.throwIfAborted();
    if (this.authority.status().mode !== "open") throw new ControlError("CONTROL_LAUNCH_DENIED");
    let containerId: string | null = null;
    if (launch.profile.backend === "docker") {
      if (!task.dockerSocket) throw new ControlError("CONTROL_DOCKER_UNAVAILABLE");
      containerId = await createOwnedContainer(task.dockerSocket, launch, task);
      this.store.recordExecutionContainer(launch.id, containerId);
    }
    signal.throwIfAborted();
    this.store.executionLaunchState(launch.id, "starting");
    await this.authority.startExecutionRole(launch, { ...task, containerId }, signal);
    this.publish(launch.id);
  }
  async report(id: Id, input: unknown): Promise<void> {
    const result = ExecutionExitSchema.parse(input);
    const launch = this.store.executionLaunch(id);
    if (!launch || result.id !== id || result.interrupted || result.stdoutBytes > 64 * 1024 * 1024 ||
        result.stderrBytes > 8 * 1024 * 1024) throw new ControlError("CONTROL_EXECUTION_RESULT_INVALID");
    if (this.stopping.has(id)) return;
    this.store.reportExecutionLaunch(id, result);
    const completion = this.finish(launch, result);
    this.stopping.set(id, completion);
    await completion;
  }
  started(id: Id): void { this.store.executionPayloadStarted(id, now()); this.publish(id); }
  private async finish(launch: ExecutionLaunch, result: ExecutionExit): Promise<ExecutionExit> {
    this.store.executionLaunchState(launch.id, "stopping");
    let image: string | null = null;
    const socket = this.authority.config.execution?.dockerSocket;
    if (launch.containerName) {
      if (!socket) throw new ControlError("CONTROL_DOCKER_UNAVAILABLE");
      const container = await inspectOwnedContainer(socket, launch);
      if (!container || container.State.Running || container.State.ExitCode !== result.code) throw new ControlError("CONTROL_EXECUTION_RESULT_UNPROVEN");
      if (launch.request.work.kind === "environment-build" && result.code === 0) image = await publishBuiltImage(socket, launch);
      await removeOwnedContainer(socket, launch);
    }
    await this.authority.stopExecutionUnit(launch.unit);
    for (const [stream, size] of [["stdout", result.stdoutBytes], ["stderr", result.stderrBytes]] as const) {
      const info = await lstat(join(launch.root, stream));
      if (!info.isFile() || info.size !== size) throw new ControlError("CONTROL_EXECUTION_RESULT_UNPROVEN");
    }
    const completed = { ...result, image };
    this.store.completeExecutionLaunch(launch.id, completed, now());
    this.aborts.delete(launch.id); this.publish(launch.id);
    return completed;
  }
  stop(id: Id, canceled: boolean): Promise<ExecutionExit> {
    const old = this.stopping.get(id);
    if (old) return old;
    const work = this.stopOwned(id, canceled);
    this.stopping.set(id, work);
    return work;
  }
  private async stopOwned(id: Id, canceled: boolean): Promise<ExecutionExit> {
    let launch = this.store.executionLaunch(id);
    if (!launch) throw new ControlError("CONTROL_EXECUTION_NOT_FOUND");
    if (launch.result) return launch.result;
    this.store.executionLaunchState(id, "stopping");
    this.aborts.get(id)?.abort();
    this.authority.cancelExecutionStart(launch.unit);
    await this.tasks.get(id)?.catch(() => undefined);
    launch = this.store.executionLaunch(id) ?? launch;
    let code: number | null = null;
    if (launch.containerName) {
      const socket = this.authority.config.execution?.dockerSocket;
      if (!socket) throw new ControlError("CONTROL_DOCKER_UNAVAILABLE");
      const container = await inspectOwnedContainer(socket, launch);
      if (container && !launch.containerId) this.store.recordExecutionContainer(id, container.Id);
      code = await removeOwnedContainer(socket, this.store.executionLaunch(id) ?? launch);
    }
    await this.authority.stopExecutionUnit(launch.unit);
    const lengths = await Promise.all(["stdout", "stderr"].map(async stream => {
      try { return (await lstat(join(launch.root, stream))).size; }
      catch (error) {
        if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) return 0;
        throw error;
      }
    }));
    const result: ExecutionExit = { id, code, canceled,
      interrupted: !canceled || launch.supervisorEpoch !== this.authority.status().supervisorEpoch,
      stdoutBytes: lengths[0] ?? 0, stderrBytes: lengths[1] ?? 0, image: null };
    this.store.completeExecutionLaunch(id, result, now());
    this.aborts.delete(id); this.publish(id);
    return result;
  }
  async parentClosed(parent: Id): Promise<void> {
    for (const launch of this.store.executionLaunches()) {
      if (launch.parentExecutionId === parent && !terminal(launch)) await this.stop(launch.id, false);
    }
  }
  async drain(): Promise<void> {
    for (const [id, abort] of this.aborts) {
      abort.abort();
      const launch = this.store.executionLaunch(id);
      if (launch) this.authority.cancelExecutionStart(launch.unit);
    }
    // A pending creation cannot be forgotten while its external call can still finish.
    await Promise.allSettled([...this.tasks.values()]);
    for (const launch of this.store.executionLaunches()) if (!terminal(launch)) await this.stop(launch.id, true);
  }
  async assertAbsent(): Promise<void> {
    for (const launch of this.store.executionLaunches()) {
      if (!terminal(launch)) throw new ControlError("CONTROL_EXECUTIONS_UNSETTLED");
    }
  }
  private async read(launch: ExecutionLaunch, stream: "stdout" | "stderr", offset: number, maximumBytes: number) {
    if (launch.state === "released") throw new ControlError("CONTROL_EXECUTION_RELEASED");
    const file = await open(join(launch.root, stream), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || offset > info.size) throw new ControlError("CONTROL_EXECUTION_OUTPUT_INVALID");
      const bytes = Buffer.alloc(Math.min(maximumBytes, info.size - offset));
      const read = await file.read(bytes, 0, bytes.length, offset);
      return { data: bytes.subarray(0, read.bytesRead).toString("base64"), nextOffset: offset + read.bytesRead,
        complete: terminal(launch) && offset + read.bytesRead === info.size };
    } finally { await file.close(); }
  }
  async close(): Promise<void> {
    this.closing = true;
    await this.transport?.close();
    await this.drain();
  }
}
