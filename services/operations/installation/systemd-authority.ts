import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DigestSchema, IdSchema, InstantSchema } from "@quire/contracts";
import type { Id, Operation } from "@quire/contracts";
import {
  ControlError, PreparedInstallation, StoppedInstallation,
} from "./model";
import type {
  ExecutionIdentity, InstallationAuthority, InstallationBinding, InstallationCapabilities,
  InstallationCommit, PrepareInstallation, RecoveryRequest,
} from "./model";
import { ControlStore } from "./control-store";
import { canonicalJson, controlDigest } from "./protocol";
import { below, driverInventoryDigest, privateDirectory, validateDriverConfig } from "./driver-config";
import type { SystemdDriverConfig } from "./driver-config";
import { cgroupPids, command, controllerLock, inspectUnit, processIdentity, spawnManager } from "./systemd-process";
import type { ProcessIdentity, UnitIdentity } from "./systemd-process";
import { handleControl, listenControl } from "./controller-server";
import type { ControlChannel } from "./controller-server";
import type { InstallationStorageHost } from "./storage";
import { ReportedUpdateFailure } from "../updates/model";
import { InstallationExecutionBroker } from "./execution-broker";
import { authenticateExecutionCommand } from "./execution-protocol";
import type { ExecutionEnvelopeSchema } from "./execution-protocol";
import type { ExecutionLaunch, ExecutionTask } from "./execution-model";
import { resolveInstallationRoleMounts } from "./role-mounts";
import { PreparedFailureReportSchema } from "./execution-ledger";
import { PreparedFailureResponseSchema } from "./prepared-failure";
import { stopExecutionProcess } from "./execution-stop";

const now = () => InstantSchema.parse(new Date().toISOString());
const id = () => IdSchema.parse(crypto.randomUUID());
class ReportedPreparedFailure extends Error {
  constructor(readonly execution: ExecutionIdentity, readonly bytes: string) {
    super(PreparedFailureReportSchema.parse(JSON.parse(bytes)).code);
  }
}
class StoppedCohort extends StoppedInstallation {
  constructor(operationId: Id, state: ReturnType<ControlStore["state"]>, executions: readonly ExecutionIdentity[]) {
    super(state.installationId, operationId, state.supervisorEpoch, state.generation, executions);
  }
}
class PreparedCohort extends PreparedInstallation {
  constructor(stopped: StoppedInstallation, binding: InstallationBinding, digest: ReturnType<typeof controlDigest>,
    readonly healthIntent: Id, readonly sessions: readonly RoleSession[]) { super(stopped, binding, digest); }
}
interface RoleSession {
  readonly peer: ProcessIdentity; readonly unit: UnitIdentity; readonly execution: ExecutionIdentity;
  readonly channel: ControlChannel; readonly token: string; readonly binding: InstallationBinding;
  readonly task?: ExecutionTask;
}
interface PendingRole {
  readonly binding: InstallationBinding; readonly purpose: ExecutionIdentity["purpose"];
  readonly ready: Promise<RoleSession>; readonly resolve: (session: RoleSession) => void;
  readonly reject: (error: Error) => void;
  readonly task?: ExecutionTask;
}
const readinessSchema = z.object({
  database: z.enum(["sqlite", "postgres"]),
  migrations: z.array(z.object({ id: z.string(), digest: DigestSchema })),
  entrypointDigest: DigestSchema,
});
export class SystemdInstallationAuthority implements InstallationAuthority {
  private readonly stopped = new WeakSet<StoppedInstallation>();
  private readonly prepared = new WeakSet<PreparedInstallation>();
  private readonly sessions = new Map<string, RoleSession>();
  private readonly pending = new Map<string, PendingRole>();
  private readonly unitJobs = new Map<string, Promise<number>>();
  private readonly scope = new AsyncLocalStorage<StoppedInstallation>();
  private tail: Promise<unknown> = Promise.resolve();
  private maintenanceTail: Promise<unknown> = Promise.resolve();
  private transport: Awaited<ReturnType<typeof listenControl>> | undefined;
  private storage: InstallationStorageHost | undefined;
  private closed = false;
  private stopping = false;
  private readonly expectedStops = new Set<string>();
  private readonly broker: InstallationExecutionBroker;
  private constructor(readonly config: SystemdDriverConfig, readonly store: ControlStore,
    private readonly lock: FileHandle, private readonly epoch: Id) { this.broker = new InstallationExecutionBroker(this); }

  static async open(input: unknown, controlPath?: string): Promise<SystemdInstallationAuthority> {
    const config = await validateDriverConfig(input);
    const lock = await controllerLock(join(config.controlRoot, "controller.lock"));
    let store: ControlStore | undefined;
    try {
      const epoch = id();
      store = ControlStore.open(controlPath ?? join(config.controlRoot, "control.sqlite"), config.installationId, epoch, now());
      store.installSupervisorExtensions();
      const authority = new SystemdInstallationAuthority(config, store, lock, epoch);
      await authority.verifyHost();
      await authority.reconcileStartup();
      const socketPath = join(config.socketRoot, "roles.sock");
      try {
        const existing = await lstat(socketPath);
        if (!existing.isSocket() || existing.uid !== process.getuid?.()) throw new ControlError("CONTROL_SOCKET_UNSAFE");
        await unlink(socketPath);
      } catch (error) {
        if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) throw error;
      }
      authority.transport = await listenControl(socketPath, (channel, peer) => {
        handleControl(channel, async (method, value) => {
          if (method === "launch") {
            z.strictObject({}).parse(value);
            return authority.serialize(() => authority.launch(channel, peer));
          }
          if (method === "ready") {
            const { token } = z.strictObject({ token: z.string() }).parse(value);
            const session = [...authority.sessions.values()].find(item => item.channel === channel && item.token === token);
            if (!session) throw new ControlError("CONTROL_LAUNCH_DENIED");
            await authority.attestSession(session);
            authority.pending.get(session.unit.unit)?.resolve(session);
            return { ready: true };
          }
          if (method === "execution.result" || method === "execution.abort" || method === "execution.started") {
            const body = z.object({ token: z.string(), result: z.unknown().optional(), reason: z.string().optional() }).parse(value);
            const session = [...authority.sessions.values()].find(item => item.channel === channel && item.token === body.token && item.task);
            if (!session?.task) throw new ControlError("CONTROL_EXECUTION_DENIED");
            const task = session.task;
            const unit = await authority.attest(session.peer, session.unit.unit);
            if (unit.invocationId !== session.unit.invocationId) throw new ControlError("CONTROL_INVOCATION_CHANGED");
            if (method === "execution.started") { authority.broker.started(task.launchId); return { accepted: true }; }
            const completion = method === "execution.result" ? authority.broker.report(task.launchId, body.result) :
              authority.broker.stop(task.launchId, body.reason !== "runner-failure");
            void completion.catch(error => {
              const operationId = authority.store.state().operationId;
              if (operationId) authority.store.requireRecovery(operationId, "CONTROL_EXECUTION_STOP_UNPROVEN", now());
              console.error("installation.execution.result.failed", error);
            });
            return { accepted: true };
          }
          if (method === "prepared.failure") {
            const body = z.strictObject({ token: z.string(), report: PreparedFailureReportSchema }).parse(value);
            const session = [...authority.sessions.values()].find(item => item.channel === channel &&
              item.token === body.token && item.execution.purpose === "prepared");
            if (!session || body.report.bindingDigest !== controlDigest(canonicalJson(session.binding))) {
              throw new ControlError("CONTROL_HEALTH_REPORT_DENIED");
            }
            await authority.attestSession(session);
            const bytes = canonicalJson(body.report);
            authority.store.reportPreparedFailure(session.execution.id, bytes);
            if (body.report.stage === "construction") authority.pending.get(session.unit.unit)?.reject(new ReportedPreparedFailure(session.execution, bytes));
            return { reportDigest: controlDigest(bytes) };
          }
          throw new ControlError("CONTROL_METHOD_DENIED");
        });
      }, config.requestBytes, config.requestTimeoutMs);
      await authority.broker.listen();
      return authority;
    } catch (error) { store?.close(); await lock.close(); throw error; }
  }
  bindStorage(storage: InstallationStorageHost): void {
    if (this.storage) throw new ControlError("CONTROL_STORAGE_ALREADY_BOUND");
    this.storage = storage;
  }
  status() { this.assertOwner(); return this.store.state(); }
  async prepareControlSocket(path: string): Promise<void> {
    this.assertOwner();
    if (path !== join(this.config.socketRoot, "control.sock")) throw new ControlError("CONTROL_SOCKET_UNSAFE");
    try {
      const info = await lstat(path);
      if (!info.isSocket() || info.uid !== process.getuid?.()) throw new ControlError("CONTROL_SOCKET_UNSAFE");
      await unlink(path);
    } catch (error) {
      if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) throw error;
    }
  }
  async prepareExecutionSocket(path: string): Promise<void> {
    this.assertOwner();
    if (path !== join(this.config.socketRoot, "executions.sock")) throw new ControlError("CONTROL_SOCKET_UNSAFE");
    try {
      const info = await lstat(path);
      if (!info.isSocket() || info.uid !== process.getuid?.()) throw new ControlError("CONTROL_SOCKET_UNSAFE");
      await unlink(path);
    } catch (error) { if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) throw error; }
  }
  private assertOwner(): void {
    if (this.closed || this.store.state().supervisorEpoch !== this.epoch) throw new ControlError("CONTROL_STALE_EPOCH");
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => undefined);
    return next;
  }
  private async verifyHost(): Promise<void> {
    this.assertOwner();
    const state = this.store.state();
    if (driverInventoryDigest(this.config) !== state.roleInventoryDigest) throw new ControlError("CONTROL_INVENTORY_INVALID");
    const own = await processIdentity({ pid: process.pid, uid: process.getuid?.() ?? -1, gid: process.getgid?.() ?? -1 });
    const controller = await inspectUnit(this.config, this.config.controllerUnit);
    if (!controller.cgroup || own.cgroup !== controller.cgroup || controller.mainPid !== process.pid ||
        own.executable !== this.config.launcher.executable || own.executableDigest !== this.config.launcher.executableDigest ||
        controller.killMode !== "control-group" || controller.sendSigkill !== "yes") {
      throw new ControlError("CONTROL_CONTROLLER_UNIT_REQUIRED");
    }
    if (await command(this.config, [this.config.launcher.executable, "--version"]) !== "1.4.4") {
      throw new ControlError("CONTROL_RUNTIME_VERSION");
    }
    // Actual mount isolation, not the user manager's silently ineffective InaccessiblePaths.
    const result = await command(this.config, ["/usr/bin/bwrap", "--unshare-pid", "--die-with-parent",
      "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev",
      "--tmpfs", this.config.controlRoot, "--", "/usr/bin/test", "!", "-e", join(this.config.controlRoot, "control.sqlite")]);
    if (result !== "") throw new ControlError("CONTROL_SANDBOX_UNAVAILABLE");
  }
  async capabilities(): Promise<InstallationCapabilities> {
    await this.verifyHost();
    await validateDriverConfig(this.config);
    if (!this.storage) throw new ControlError("UPDATES_RESTORE_UNAVAILABLE");
    if (this.store.state().mode !== "open") throw new ControlError("CONTROL_LAUNCH_DENIED");
    for (const role of this.config.roles) {
      const session = this.sessions.get(role.unit);
      if (!session) throw new ControlError("UPDATES_LAUNCHER_UNAVAILABLE", `Unprobed role slot ${role.unit}`);
      await this.attestSession(session);
      const health = readinessSchema.parse(await session.channel.request("check", this.sessionInput(session)));
      if (health.database !== session.binding.data.dialect ||
          health.entrypointDigest !== controlDigest(await readFile(join(session.binding.release.target, session.binding.release.entrypoint)))) {
        throw new ControlError("CONTROL_RELEASE_IDENTITY_MISMATCH");
      }
    }
    const freshRestore = await this.storage.capabilities();
    const state = this.store.state();
    return { driver: "systemd-local-v1", installationId: state.installationId,
      roleInventoryDigest: state.roleInventoryDigest, dialect: state.binding.data.dialect, freshRestore };
  }
  private async attest(peer: ProcessIdentity, expectedUnit?: string): Promise<UnitIdentity> {
    this.assertOwner();
    const actual = await processIdentity(peer);
    if (canonicalJson(actual) !== canonicalJson(peer) ||
        actual.executable !== this.config.launcher.executable ||
        actual.executableDigest !== this.config.launcher.executableDigest ||
        actual.command[1] !== this.config.launcher.script) throw new ControlError("CONTROL_PROCESS_CHANGED");
    const inventory = [...this.config.roles, { role: "maintenance", unit: this.config.helperUnit, activators: [] },
      ...this.store.executionLaunches().filter(launch => !["exited", "interrupted", "released"].includes(launch.state))
        .map(launch => ({ role: launch.profile.workerRole ?? "execution", unit: launch.unit, activators: [] }))];
    const roles = expectedUnit ? inventory.filter(role => role.unit === expectedUnit) : inventory;
    for (const role of roles) {
      const unit = await inspectUnit(this.config, role.unit);
      if (unit.cgroup && actual.cgroup === unit.cgroup && /^[0-9a-f]{32}$/.test(unit.invocationId) &&
          ["active", "activating"].includes(unit.state) && unit.bindsTo.includes(this.config.controllerUnit) &&
          unit.killMode === "control-group" && unit.sendSigkill === "yes" && unit.restart === "no" &&
          (await cgroupPids(unit.cgroup)).includes(actual.pid)) return unit;
    }
    throw new ControlError("CONTROL_COHORT_MISMATCH");
  }
  private async attestSession(session: RoleSession): Promise<void> {
    const unit = await this.attest(session.peer, session.unit.unit);
    const state = this.store.state();
    if (unit.invocationId !== session.unit.invocationId || session.channel.socket.destroyed ||
        session.execution.supervisorEpoch !== state.supervisorEpoch ||
        session.execution.generation !== state.generation) throw new ControlError("CONTROL_INVOCATION_CHANGED");
  }
  async authenticateCaller(peer: ProcessIdentity, channel: "api" | "operator", role: string | null): Promise<void> {
    this.assertOwner();
    const actual = await processIdentity(peer);
    if (canonicalJson(actual) !== canonicalJson(peer) || actual.uid !== process.getuid?.()) throw new ControlError("CONTROL_PEER_DENIED");
    if (channel === "operator") return;
    const session = [...this.sessions.values()].find(item => item.peer.pid === peer.pid && item.execution.role === role);
    if (!session || this.store.state().mode !== "open") throw new ControlError("CONTROL_CALLER_DENIED");
    await this.attestSession(session);
  }
  async authenticateExecutionPeer(peer: ProcessIdentity, input: z.infer<typeof ExecutionEnvelopeSchema>) {
    const session = [...this.sessions.values()].find(item => item.execution.id === input.parentExecutionId);
    if (!session || session.channel.socket.destroyed || canonicalJson(session.peer) !== canonicalJson(peer) ||
        input.supervisorEpoch !== session.execution.supervisorEpoch || input.generation !== session.execution.generation) {
      throw new ControlError("CONTROL_EXECUTION_UNAUTHENTICATED");
    }
    authenticateExecutionCommand(input, session.token);
    const unit = await this.attest(peer, session.unit.unit);
    if (unit.invocationId !== session.unit.invocationId) throw new ControlError("CONTROL_INVOCATION_CHANGED");
    return session;
  }
  executionPid(executionId: Id): number | null {
    return [...this.sessions.values()].find(session => session.execution.id === executionId)?.peer.pid ?? null;
  }
  private async launch(channel: ControlChannel, peer: ProcessIdentity) {
    const unit = await this.attest(peer);
    const pending = this.pending.get(unit.unit);
    const state = this.store.state();
    if (!pending || this.sessions.has(unit.unit) ||
        (pending.purpose === "ordinary" ? state.mode !== "open" : state.mode !== "installing")) {
      throw new ControlError("CONTROL_LAUNCH_DENIED");
    }
    const role = pending.task ? { role: pending.task.profile.workerRole ?? "execution" } :
      unit.unit === this.config.helperUnit ? { role: "maintenance" } : this.config.roles.find(item => item.unit === unit.unit);
    if (!role) throw new ControlError("CONTROL_COHORT_MISMATCH");
    const execution: ExecutionIdentity = {
      id: id(), installationId: state.installationId, supervisorEpoch: state.supervisorEpoch,
      generation: state.generation, role: role.role, unit: unit.unit, invocationId: unit.invocationId,
      operationId: pending.purpose === "ordinary" ? null : state.operationId, purpose: pending.purpose,
      containerIds: pending.task?.containerId ? [pending.task.containerId] : [],
    };
    if (pending.task) this.store.bindExecutionLaunch(pending.task.launchId, execution, now());
    else {
      this.store.executionIntent(execution, now());
      this.store.acknowledgeExecution(execution.id, "started", now());
    }
    const token = randomBytes(32).toString("hex");
    const session: RoleSession = { peer, unit, execution, channel, token, binding: pending.binding,
      ...(pending.task ? { task: pending.task } : {}) };
    this.sessions.set(unit.unit, session);
    void channel.closed.then(() => {
      pending.reject(new ControlError("CONTROL_PREPARED_CHILD_DIED"));
      if (!this.closed) void this.broker.parentClosed(session.execution.id).catch(error => console.error("installation.execution.parent.failed", error));
      if (pending.task && !this.closed && !this.expectedStops.has(unit.unit)) {
        void this.broker.stop(pending.task.launchId, false).catch(error => console.error("installation.execution.lost", error));
      }
      if (!this.closed && !this.stopping && !this.expectedStops.has(unit.unit) && this.sessions.get(unit.unit) === session &&
          this.store.state().mode === "installing" && this.store.state().operationId !== null) {
        const operationId = this.store.state().operationId;
        if (operationId !== null) this.store.requireRecovery(operationId, "CONTROL_ROLE_DISCONNECTED", now());
      }
    });
    return { execution, binding: pending.binding, token, ...(pending.task ? { task: pending.task } : {}) };
  }
  private async startRole(unit: string, binding: InstallationBinding, purpose: PendingRole["purpose"],
    task?: ExecutionTask, signal?: AbortSignal): Promise<RoleSession> {
    this.assertOwner();
    await validateDriverConfig(this.config);
    if (this.pending.has(unit) || this.sessions.has(unit)) throw new ControlError("CONTROL_SLOT_OCCUPIED");
    const previous = await inspectUnit(this.config, unit);
    if (!["inactive", "failed"].includes(previous.state) || previous.mainPid !== 0 ||
        (previous.cgroup && (await cgroupPids(previous.cgroup)).length !== 0)) throw new ControlError("CONTROL_SLOT_OCCUPIED");
    await this.unitJobs.get(unit);
    if (previous.state === "failed") await command(this.config, ["/usr/bin/systemctl", "--user", "reset-failed", unit]);
    const ready = Promise.withResolvers<RoleSession>();
    // Observe rejection before systemd starts: a fast failed launcher must not become an unhandled rejection.
    void ready.promise.catch(() => undefined);
    this.pending.set(unit, { binding, purpose, ready: ready.promise, resolve: ready.resolve, reject: ready.reject, ...(task ? { task } : {}) });
    const state = this.store.state();
    const manifest = join(this.config.controlRoot, `launch-${state.supervisorEpoch}-${unit}-${id()}.json`);
    const file = await open(manifest, "wx", 0o600);
    try { await file.writeFile(canonicalJson({ unit, binding, purpose, generation: state.generation, epoch: state.supervisorEpoch })); await file.sync(); }
    finally { await file.close(); }
    const directory = await open(this.config.controlRoot, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    const ordinary = purpose === "ordinary" || purpose === "prepared";
    const role = task?.profile.workerRole ?? this.config.roles.find(item => item.unit === unit)?.role ?? "execution";
    const mounts = ordinary && (!task || task.request.work.kind === "worker")
      ? await resolveInstallationRoleMounts(this.config, binding, role) : null;
    const writable = mounts ? mounts.writableRoots : ordinary ? [] : this.config.maintenanceRoots;
    for (const root of writable) {
      await privateDirectory(root);
      if ([this.config.controlRoot, this.config.socketRoot, this.config.applicationRoot, this.config.launcher.executable,
        this.config.launcher.script].some(protectedPath => below(root, protectedPath) || below(protectedPath, root))) {
        throw new ControlError("CONTROL_ROOT_OVERLAP");
      }
    }
    const timer = setTimeout(() => ready.reject(new ControlError("CONTROL_ROLE_READINESS_TIMEOUT")), this.config.requestTimeoutMs);
    const cancel = () => ready.reject(new ControlError("CONTROL_EXECUTION_CANCELED"));
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      signal?.throwIfAborted();
      if (purpose === "ordinary" && this.store.state().mode !== "open") throw new ControlError("CONTROL_LAUNCH_DENIED");
      const launched = spawnManager(this.config, ["/usr/bin/systemd-run", "--user", "--quiet", "--wait", `--unit=${unit}`,
        "--service-type=exec", "--property=KillMode=control-group", "--property=SendSIGKILL=yes",
        "--property=Restart=no", `--property=BindsTo=${this.config.controllerUnit}`,
        `--property=After=${this.config.controllerUnit}`, "--property=TimeoutStopSec=15",
        ...(task ? [`--property=MemoryMax=${task.request.limits.memoryBytes}`, "--property=MemorySwapMax=0",
          `--property=TasksMax=${task.request.limits.processes}`, "--property=CPUQuota=100%",
          `--property=RuntimeMaxSec=${task.request.limits.wallSeconds + 30}`] : []),
        // Native payloads need their one real bwrap namespace; nesting it inside
        // an application-role namespace is denied on supported restricted hosts.
        // This branch runs only the pinned execution monitor, never caller argv
        // or an application factory. Its payload is confined by nativeExecutionCommand.
        ...(task?.profile.backend === "bwrap" ? [] : [
        "/usr/bin/bwrap", "--unshare-pid", "--die-with-parent", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
        "--tmpfs", this.config.controlRoot, "--tmpfs", "/run",
        "--ro-bind", this.config.applicationRoot, this.config.applicationRoot,
        "--ro-bind", this.config.launcher.executable, this.config.launcher.executable,
        "--ro-bind", this.config.launcher.script, this.config.launcher.script,
        "--ro-bind", this.config.socketRoot, this.config.socketRoot, ...writable.flatMap(root => ["--bind", root, root]),
        ...(mounts?.readOnlyFiles.flatMap(path => ["--ro-bind", path, path]) ?? []),
        ...(task ? ["--bind", task.root, task.root, ...(task.source ? ["--ro-bind", task.source, task.source] : []),
          ...(task.dockerSocket && task.profile.backend === "docker" ? ["--ro-bind", task.dockerSocket, task.dockerSocket] : [])] : []),
        ...(ordinary ? [] :
          this.config.maintenanceSecrets.flatMap(path => ["--ro-bind", path, path])),
        "--"]),
        this.config.launcher.executable, this.config.launcher.script, join(this.config.socketRoot, "roles.sock")]);
      this.unitJobs.set(unit, launched.exited);
      // --wait observes this manager invocation's actual completion, including failure before the socket connects.
      void Promise.all([launched.exited, new Response(launched.stdout).text(), new Response(launched.stderr).text()])
        .then(([code, output, error]) => ready.reject(new ControlError("CONTROL_ROLE_EXITED", `exit=${code}: ${output}${error}`)),
          error => ready.reject(error instanceof Error ? error : new Error(String(error))));
      return await ready.promise;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); this.pending.delete(unit); }
  }
  async startExecutionRole(launch: ExecutionLaunch, task: ExecutionTask, signal: AbortSignal): Promise<void> {
    const session = await this.startRole(launch.unit, launch.binding, "ordinary", task, signal);
    signal.throwIfAborted();
    await this.attestSession(session);
    await session.channel.request("execution.start", this.sessionInput(session));
  }
  cancelExecutionStart(unit: string): void { this.pending.get(unit)?.reject(new ControlError("CONTROL_EXECUTION_CANCELED")); }
  async stopExecutionUnit(unit: string): Promise<void> {
    if (!this.store.executionLaunches().some(launch => launch.unit === unit)) throw new ControlError("CONTROL_EXECUTION_FORBIDDEN");
    this.expectedStops.add(unit);
    this.cancelExecutionStart(unit);
    try {
      await stopExecutionProcess(this.config, unit, this.unitJobs.get(unit));
      this.sessions.delete(unit);
    } finally { this.expectedStops.delete(unit); }
  }
  async startCommittedRoles(): Promise<void> {
    this.assertOwner();
    if (this.store.state().mode !== "open") throw new ControlError("CONTROL_LAUNCH_DENIED");
    for (const role of this.config.roles.toReversed()) {
      const session = await this.startRole(role.unit, this.store.state().binding, "ordinary");
      await this.attestSession(session);
      await session.channel.request("activate", this.sessionInput(session));
    }
  }
  private sessionInput(session: RoleSession) {
    return { token: session.token, epoch: session.execution.supervisorEpoch, generation: session.execution.generation };
  }
  private async inventory(): Promise<readonly UnitIdentity[]> {
    const launches = this.store.executionLaunches();
    const units = [...this.config.roles.flatMap(role => [...role.activators, role.unit]), this.config.helperUnit,
      ...launches.map(launch => launch.unit)];
    const records = this.store.executions();
    if (records.some(record => !units.includes(record.identity.unit) || record.identity.containerIds.some(container =>
      !launches.some(launch => launch.executionId === record.identity.id && launch.containerId === container)))) {
      throw new ControlError("CONTROL_UNOWNED_EXECUTION");
    }
    return Promise.all(units.map(unit => inspectUnit(this.config, unit)));
  }
  private async absent(): Promise<readonly UnitIdentity[]> {
    await this.broker.assertAbsent();
    const inventory = await this.inventory();
    for (const unit of inventory) {
      if (!["inactive", "failed"].includes(unit.state) || unit.mainPid !== 0 ||
          (unit.cgroup && (await cgroupPids(unit.cgroup)).length !== 0)) throw new ControlError("CONTROL_COHORT_NOT_STOPPED");
    }
    return inventory;
  }
  private async reconcileStartup(): Promise<void> {
    const before = await this.inventory();
    for (const unit of before) {
      if (!["inactive", "failed"].includes(unit.state)) await command(this.config, ["/usr/bin/systemctl", "--user", "stop", unit.unit]);
      if (unit.cgroup && (await cgroupPids(unit.cgroup)).length) throw new ControlError("CONTROL_COHORT_NOT_STOPPED");
    }
    await this.broker.drain();
    await this.absent();
    for (const record of this.store.executions()) {
      if (record.exitedAt !== null) continue;
      if (record.identity.purpose === "ordinary") this.store.acknowledgeExecution(record.identity.id, "exited", now());
      else if (record.identity.purpose === "prepared" && record.identity.operationId !== null) {
        const receipt = this.store.receipt(record.identity.operationId);
        if (receipt && ["succeeded", "failed"].includes(receipt.operation.status)) this.store.acknowledgeReplacedRoleExit(record.identity.id, now());
      }
    }
  }
  async stopForUpdate(operationId: Id): Promise<StoppedInstallation> {
    return this.serialize(async () => {
      this.assertOwner();
      if (this.store.state().mode === "open") this.store.inhibit(operationId, now());
      const state = this.store.state();
      if (state.operationId !== operationId || state.mode === "open") throw new ControlError("CONTROL_NOT_OWNER");
      try {
        this.stopping = true;
        await this.broker.drain();
        const before = await this.inventory();
        // systemctl subscribes to JobRemoved before submitting StopUnit, and waits for the job.
        for (const role of this.config.roles) {
          for (const unit of role.activators) {
            if (before.some(item => item.unit === unit && !["inactive", "failed"].includes(item.state))) {
              await command(this.config, ["/usr/bin/systemctl", "--user", "stop", unit]);
            }
          }
        }
        for (const unit of [...this.config.roles.map(role => role.unit), this.config.helperUnit]) {
          if (before.some(item => item.unit === unit && !["inactive", "failed"].includes(item.state))) {
            await command(this.config, ["/usr/bin/systemctl", "--user", "stop", unit]);
          }
          await this.unitJobs.get(unit);
        }
        for (const unit of before) if (unit.cgroup && (await cgroupPids(unit.cgroup)).length) {
          throw new ControlError("CONTROL_COHORT_NOT_STOPPED");
        }
        const after = await this.absent();
        for (const record of this.store.executions()) if (record.exitedAt === null) {
          if (record.identity.purpose !== "ordinary" && (record.identity.supervisorEpoch !== state.supervisorEpoch ||
              record.identity.generation < state.generation) && state.mode === "installing") {
            this.store.acknowledgeRecoveredExit(record.identity.id, now());
          } else {
            this.store.acknowledgeExecution(record.identity.id, "exited", now(),
              record.identity.purpose === "prepared" ? canonicalJson({ cancelledPrepared: true, after }) : null);
          }
        }
        this.sessions.clear();
        const invocations = this.store.executions().map(record => record.identity);
        this.store.recordStopped(operationId, { observedAt: now(), inventoryDigest: state.roleInventoryDigest,
          managerEvidenceBytes: canonicalJson({ before, after }), executions: invocations }, now());
        const stopped = new StoppedCohort(operationId, this.store.state(), invocations);
        this.stopped.add(stopped);
        return stopped;
      } catch (error) { this.store.requireRecovery(operationId, "CONTROL_STOP_UNPROVEN", now()); throw error; }
      finally { this.stopping = false; }
    });
  }
  async assertStopped(stopped: StoppedInstallation): Promise<void> {
    this.assertOwner();
    const state = this.store.state();
    if (!this.stopped.has(stopped) || state.mode !== "installing" || state.operationId !== stopped.operationId ||
        state.generation !== stopped.generation || state.supervisorEpoch !== stopped.supervisorEpoch) {
      throw new ControlError("CONTROL_STOPPED_AUTHORITY_INVALID");
    }
    await this.absent();
  }
  async withStopped<T>(stopped: StoppedInstallation, work: () => Promise<T>): Promise<T> {
    if (this.scope.getStore() === stopped) { await this.assertStopped(stopped); return work(); }
    const next = this.maintenanceTail.then(() =>
      this.scope.run(stopped, async () => { await this.assertStopped(stopped); return work(); }));
    this.maintenanceTail = next.catch(() => undefined);
    return next;
  }
  async runMaintenance(stopped: StoppedInstallation, purpose: "backup" | "preflight" | "migration" | "restore" | "health",
    binding: InstallationBinding, input: unknown): Promise<{ execution: ExecutionIdentity; resultBytes: string; result: unknown }> {
    if (this.scope.getStore() !== stopped) return this.withStopped(stopped, () => this.runMaintenance(stopped, purpose, binding, input));
    await this.assertStopped(stopped);
    const intentId = id();
    this.store.recordIntent({ id: intentId, operationId: stopped.operationId, supervisorEpoch: stopped.supervisorEpoch,
      generation: stopped.generation, kind: purpose, inputBytes: canonicalJson({ binding, input }), createdAt: now() });
    try {
      const session = await this.startRole(this.config.helperUnit, binding, purpose);
      const result = await session.channel.request("execute", { ...this.sessionInput(session), input });
      await this.attestSession(session);
      this.stopping = true;
      await command(this.config, ["/usr/bin/systemctl", "--user", "stop", this.config.helperUnit]);
      await this.unitJobs.get(this.config.helperUnit);
      if ((await cgroupPids(session.unit.cgroup)).length) throw new ControlError("CONTROL_HELPER_NOT_STOPPED");
      const bytes = canonicalJson(result);
      this.store.acknowledgeExecution(session.execution.id, "exited", now(), bytes);
      this.sessions.delete(this.config.helperUnit);
      const response = z.discriminatedUnion("outcome", [
        z.object({ outcome: z.literal("succeeded"), value: z.unknown() }),
        z.object({ outcome: z.literal("failed"), code: z.string(), detail: z.string() }),
      ]).parse(result);
      if (response.outcome === "failed") {
        this.store.recordResult(intentId, "failed", bytes, now());
        throw new ReportedUpdateFailure(response.code, { execution: session.execution, resultBytes: bytes, migrationDigests: [] });
      }
      this.store.recordResult(intentId, "succeeded", bytes, now());
      return { execution: session.execution, resultBytes: bytes, result: response.value };
    } catch (error) {
      if (!(error instanceof ReportedUpdateFailure)) this.store.requireRecovery(stopped.operationId, "CONTROL_HELPER_INTERRUPTED", now());
      throw error;
    } finally { this.stopping = false; }
  }
  async prepare(input: PrepareInstallation): Promise<PreparedInstallation> {
    if (this.scope.getStore() !== input.stopped) return this.withStopped(input.stopped, () => this.prepare(input));
    await this.assertStopped(input.stopped);
    const outerHealth = this.store.intents(input.stopped.operationId).filter(intent =>
      intent.kind === "health" && intent.outcome === null && intent.supervisorEpoch === input.stopped.supervisorEpoch &&
      intent.generation === input.stopped.generation && intent.inputBytes === canonicalJson(input.binding));
    if (outerHealth.length > 1) throw new ControlError("CONTROL_HEALTH_INTENT_AMBIGUOUS");
    await validateDriverConfig(this.config);
    if (await realpath(join(this.config.applicationRoot, "current")) !== input.binding.release.target) {
      throw new ControlError("CONTROL_RELEASE_POINTER_MISMATCH");
    }
    if (!this.storage) throw new ControlError("UPDATES_RESTORE_UNAVAILABLE");
    await this.storage.checkBinding(input.stopped, input.binding);
    const healthIntent = id();
    const state = this.store.state();
    this.store.recordIntent({ id: healthIntent, operationId: input.stopped.operationId, supervisorEpoch: state.supervisorEpoch,
      generation: state.generation, kind: "health", inputBytes: canonicalJson(input.binding), createdAt: now() });
    try {
      const sessions: RoleSession[] = [];
      const health: unknown[] = [];
      for (const role of this.config.roles.toReversed()) {
        const session = await this.startRole(role.unit, input.binding, "prepared");
        await this.attestSession(session);
        const response = await session.channel.request("check", this.sessionInput(session));
        const failed = PreparedFailureResponseSchema.safeParse(response);
        if (failed.success) {
          const report = this.store.preparedFailureReport(session.execution.id);
          if (!report || controlDigest(report) !== failed.data.reportDigest) throw new ControlError("CONTROL_HEALTH_REPORT_MISMATCH");
          throw new ReportedPreparedFailure(session.execution, report);
        }
        const result = readinessSchema.parse(response);
        if (result.entrypointDigest !== controlDigest(await readFile(join(input.binding.release.target, input.binding.release.entrypoint))) ||
            result.database !== input.binding.data.dialect ||
            input.expectedMigrationDigests.some(digest => !result.migrations.some(row => row.digest === digest))) {
          throw new ControlError("CONTROL_PREPARED_SCHEMA_MISMATCH");
        }
        sessions.push(session); health.push({ execution: session.execution, process: session.peer, readiness: result });
      }
      const bytes = canonicalJson(health);
      this.store.recordResult(healthIntent, "succeeded", bytes, now());
      const prepared = new PreparedCohort(input.stopped, input.binding, controlDigest(bytes), healthIntent, sessions);
      this.prepared.add(prepared);
      return prepared;
    } catch (error) {
      if (error instanceof ReportedPreparedFailure && this.store.state().mode === "installing") {
        try { await this.completePreparedHealthFailure(input, healthIntent, outerHealth[0]?.id ?? healthIntent, error); }
        catch (drainError) {
          this.store.requireRecovery(input.stopped.operationId, "CONTROL_HEALTH_DRAIN_UNPROVEN", now());
          throw drainError;
        }
        throw new ReportedUpdateFailure(error.message, { execution: error.execution, migrationDigests: [], resultBytes: error.bytes });
      }
      this.store.requireRecovery(input.stopped.operationId, "CONTROL_PREPARE_FAILED", now());
      throw error;
    }
  }
  private async completePreparedHealthFailure(input: PrepareInstallation, internalHealth: Id, outerHealth: Id,
    failure: ReportedPreparedFailure): Promise<void> {
    const cohort = [...this.sessions.values()].filter(session => session.execution.purpose === "prepared" &&
      session.execution.operationId === input.stopped.operationId &&
      session.execution.generation === input.stopped.generation);
    if (!cohort.some(session => session.execution.id === failure.execution.id) ||
        this.store.preparedFailureReport(failure.execution.id) !== failure.bytes) throw new ControlError("CONTROL_HEALTH_FAILURE_UNPROVEN");
    for (const session of cohort) await this.attestSession(session);
    const before = await this.inventory();
    const stopIntent = id();
    this.store.recordIntent({ id: stopIntent, operationId: input.stopped.operationId,
      supervisorEpoch: input.stopped.supervisorEpoch, generation: input.stopped.generation, kind: "stop",
      inputBytes: canonicalJson({ kind: "prepared-health-drain", failed: failure.execution.id,
        cohort: cohort.map(session => session.execution) }), createdAt: now() });
    this.stopping = true;
    for (const session of cohort) this.expectedStops.add(session.unit.unit);
    try {
      await this.broker.drain();
      for (const session of cohort) {
        await command(this.config, ["/usr/bin/systemctl", "--user", "stop", session.unit.unit]);
        await this.unitJobs.get(session.unit.unit);
        if ((await cgroupPids(session.unit.cgroup)).length) throw new ControlError("CONTROL_COHORT_NOT_STOPPED");
        this.sessions.delete(session.unit.unit);
      }
      const after = await this.absent();
      const stoppedBytes = canonicalJson({ before, after });
      for (const session of cohort) this.store.acknowledgeExecution(session.execution.id, "exited", now(),
        session.execution.id === failure.execution.id ? failure.bytes :
          canonicalJson({ kind: "prepared-canceled", cause: failure.execution.id, stopIntent, after }));
      this.store.recordResult(stopIntent, "succeeded", stoppedBytes, now());
      this.store.recordResult(internalHealth, "failed", failure.bytes, now());
      this.store.recordCompletedHealthFailure({
        failedExecutionId: failure.execution.id, operationId: input.stopped.operationId,
        supervisorEpoch: input.stopped.supervisorEpoch, generation: input.stopped.generation,
        healthIntentId: outerHealth, bindingDigest: controlDigest(canonicalJson(input.binding)),
        resultBytes: failure.bytes,
        drainedExecutions: this.store.executions().filter(record =>
          record.identity.purpose === "prepared" && record.identity.operationId === input.stopped.operationId &&
          record.identity.supervisorEpoch === input.stopped.supervisorEpoch &&
          record.identity.generation === input.stopped.generation).map(record => record.identity),
        stopEvidenceDigest: controlDigest(stoppedBytes), stopEvidenceBytes: stoppedBytes,
      });
    } finally {
      for (const session of cohort) this.expectedStops.delete(session.unit.unit);
      this.stopping = false;
    }
  }
  async commit(input: InstallationCommit): Promise<Operation> {
    const committed = await this.serialize(async () => {
      this.assertOwner();
      const prepared = input.prepared;
      if (!(prepared instanceof PreparedCohort) || !this.prepared.has(prepared) ||
          prepared.sessions.length !== this.config.roles.length) throw new ControlError("CONTROL_PREPARED_AUTHORITY_INVALID");
      try {
        for (const session of prepared.sessions) await this.attestSession(session);
      } catch (error) {
        this.store.requireRecovery(prepared.stopped.operationId, "CONTROL_PREPARED_CHILD_DIED", now());
        throw error;
      }
      const result = this.store.commit({
        operationId: prepared.stopped.operationId, supervisorEpoch: prepared.stopped.supervisorEpoch,
        generation: prepared.stopped.generation, binding: prepared.binding, healthIntentId: prepared.healthIntent,
        outcome: input.operation.status === "succeeded" ? "succeeded" : "failed",
        errorCode: input.operation.errorCode, resultBytes: input.resultBytes, successfulFloor: input.successfulFloor, at: now(),
      });
      this.prepared.delete(prepared);
      return { result, sessions: prepared.sessions };
    });
    // Activation can start managed children whose launch handshake needs the
    // admission queue. Keep the durable commit serialized, not those callbacks.
    for (const session of committed.sessions) {
      await this.attestSession(session);
      await session.channel.request("activate", this.sessionInput(session));
    }
    return committed.result;
  }
  async recover(input: RecoveryRequest): Promise<Operation> {
    const state = this.status();
    if (state.mode !== "installing" || state.installationId !== input.installationId ||
        state.operationId !== input.operationId || state.supervisorEpoch !== input.supervisorEpoch ||
        state.generation !== input.generation) throw new ControlError("CONTROL_RECOVERY_AUTHORIZATION_REQUIRED");
    if (!this.storage) throw new ControlError("UPDATES_RESTORE_UNAVAILABLE");
    const stopped = await this.stopForUpdate(input.operationId);
    return this.storage.recover(stopped);
  }
  async close(): Promise<void> {
    await this.broker.close();
    this.closed = true;
    await this.transport?.close();
    this.store.close();
    await this.lock.close();
  }
}
