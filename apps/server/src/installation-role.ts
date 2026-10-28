import { createHmac } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { EnvironmentSchema, IdSchema } from "@quire/contracts";
import type { Environment, Id } from "@quire/contracts";
import { prepareRuntime, PreparedLifecycle, SqliteExecutor, systemClock } from "@quire/runtime";
import type { RealtimeSocketData, Runtime, RuntimeOptions } from "@quire/runtime";
import type { InstallationBinding } from "../../../services/operations/installation/model";
import { ControlError } from "../../../services/operations/installation/model";
import type { ControlledLifecycle, ControlledRoleSession } from "../../../services/operations/installation/controller-server";
import { controlledRoleBinding, installationRoleSession } from "../../../services/operations/installation/launch";
import { ExecutionTaskSchema, ExecutionWorkSchema } from "../../../services/operations/installation/execution-model";
import type { ExecutionWork } from "../../../services/operations/installation/execution-model";
import { canonicalJson } from "../../../services/operations/installation/protocol";
import { assertInstallationDatabase, installationEnvironment, installationPreparedAdapters, loadInstallationRole } from "../../../services/operations/installation/binding";
import { installationUpdateClient } from "../../../services/operations/installation/client";
import { createApplication, modules } from "./composition";
import { applicationMigrations } from "./migrations";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { PostgresBranchCoordinator } from "./scale";
import { verifyRuntimeSchema } from "../../../packages/runtime/src/prepared";
import { startRepositoryServer } from "../../../services/operations/repository";
import { sshModules, startSshBridge, readClient } from "../../../services/operations/ssh";
import { CoreProjects } from "../../../services/core/base";
import { GitRepository, serveGitSession } from "../../../services/core/git";
import { WorkerController } from "../../../services/operations/workers";
import { runRemoteWorker } from "../../../workers/compiler/remote";

/** The signed release factory is callable only inside a live launcher session. */
export async function prepareInstallationRole(binding: InstallationBinding, name: string): Promise<ControlledLifecycle> {
  return prepareRole(binding, name, controlledRoleBinding(binding, name));
}
export async function prepareInstallationWorker(
  binding: InstallationBinding, request: Extract<ExecutionWork, { kind: "worker" }>,
): Promise<ControlledLifecycle> {
  const session = installationRoleSession();
  if (!session || canonicalJson(session.permit.binding) !== canonicalJson(binding)) throw new ControlError("CONTROL_LAUNCH_REQUIRED");
  const task = ExecutionTaskSchema.parse(session.permit.task);
  const work = ExecutionWorkSchema.parse(request);
  if (work.kind !== "worker" || canonicalJson(work) !== canonicalJson(task.request.work) || !task.profile.workerRole) {
    throw new ControlError("CONTROL_WORKER_FACTORY_REQUIRED");
  }
  try { return await prepareRole(binding, task.profile.workerRole, session, work); }
  catch (error) { console.error("installation.worker.prepare.failed", error); throw error; }
}
async function workerEnvironments(binding: InstallationBinding, env: NodeJS.ProcessEnv, ids: readonly Id[]): Promise<readonly Environment[]> {
  if (new Set(ids).size !== ids.length) throw new ControlError("CONTROL_WORKER_CONFIG_REQUIRED");
  const query = `SELECT id,manifest_json FROM environments WHERE available=1 AND retired_at IS NULL
    AND id IN (${ids.map(() => "?").join(",")})`;
  const rows = z.array(z.object({ id: IdSchema, manifest_json: z.string() }));
  let stored: z.infer<typeof rows>;
  if (binding.data.dialect === "sqlite") {
    const database = new SqliteExecutor(new Database(join(binding.data.dataRoot, "quire.sqlite"), { readonly: true, strict: true }));
    try { stored = rows.parse(await database.all(query, ids)); }
    finally { await database.close(); }
  } else {
    const storage = await createPostgresStorage({ url: z.url().parse(env["QUIRE_POSTGRES_URL"]) });
    try {
      await assertInstallationDatabase(storage.db, binding.data.database.identity);
      stored = rows.parse(await storage.db.all(query, ids));
    } finally { await storage.close(); }
  }
  return ids.map(id => {
    const row = stored.find(value => value.id === id);
    if (!row) throw new ControlError("CONTROL_WORKER_ENVIRONMENT_UNAVAILABLE");
    const environment = EnvironmentSchema.parse(JSON.parse(row.manifest_json));
    if (environment.id !== id || !environment.available) throw new ControlError("CONTROL_WORKER_ENVIRONMENT_UNAVAILABLE");
    return environment;
  });
}
async function prepareRole(binding: InstallationBinding, name: string, session: ControlledRoleSession,
  workerRequest?: Extract<ExecutionWork, { kind: "worker" }>): Promise<ControlledLifecycle> {
  const { manifest, role, inventory } = await loadInstallationRole(binding, name);
  if (manifest.installationId !== session.permit.execution.installationId) throw new ControlError("CONTROL_BINDING_MISMATCH");
  if (workerRequest && role.kind !== "worker") throw new ControlError("CONTROL_WORKER_FACTORY_REQUIRED");
  if (["worker", "worker-controller"].includes(role.kind) && !role.coordinator) throw new ControlError("CONTROL_WORKER_CONFIG_REQUIRED");
  const { env, config, dataRoot } = await installationEnvironment(binding, role);
  const observed = (lifecycle: ControlledLifecycle): ControlledLifecycle => ({
    check: () => lifecycle.check(),
    async activate() {
      try { await lifecycle.activate(); }
      catch (error) { console.error("installation.role.activation.failed", { role: name, error }); throw error; }
      // Operational observation only; no launch or recovery decision reads it.
      const path = join(dataRoot, `.installation-active-${encodeURIComponent(name)}.json`);
      const temporary = `${path}.${crypto.randomUUID()}`;
      await writeFile(temporary, JSON.stringify({ pid: process.pid, binding,
        execution: session.permit.execution }), { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
    },
    dispose: () => lifecycle.dispose(),
  });
  const prepareAdapters = installationPreparedAdapters(binding, env);
  const adapterOptions = prepareAdapters ? { prepareAdapters } : {};
  const permitActivation = () => {
    if (session.permit.execution.purpose === "preflight") throw new ControlError("CONTROL_ACTIVATION_DENIED");
    if (session.channel.socket.destroyed) throw new ControlError("CONTROL_DISCONNECTED");
  };
  if (role.kind === "api") {
    if (!role.apiCredentialFile) throw new ControlError("CONTROL_API_CREDENTIAL_REQUIRED");
    const client = await installationUpdateClient(manifest.controlSocket, join(dataRoot, role.apiCredentialFile), manifest.installationId);
    const baseline = new Set((await applicationMigrations()).map(migration => migration.id));
    const extra = inventory.migrations.filter(migration => !baseline.has(migration.id));
    const app = await createApplication({
      config, startup: "prepared", ...adapterOptions, adapters: {},
      modules: [...modules, ...(extra.length ? [{
        id: "099-o-installation-schema", lane: "O" as const, order: 999, migrations: extra, register() {},
      }] : [])],
      updates: { installationId: manifest.installationId, client },
    });
    let server: ReturnType<typeof Bun.serve<RealtimeSocketData>> | undefined;
    try {
      // Bind the real listener while its prepared transport rejects all callers.
      // Port/configuration failures are therefore observed before commit.
      server = Bun.serve<RealtimeSocketData>({
        hostname: config.host, port: config.port, maxRequestBodySize: config.maxRequestBytes,
        fetch: app.handle, websocket: app.websocket,
      });
    } catch (error) { await app.dispose(); throw error; }
    const lifecycle = new PreparedLifecycle(async () => {
      permitActivation();
      await app.activate();
    }, async () => { await server?.stop(true); await app.dispose(); });
    return observed({ check: app.check, activate: () => lifecycle.activate(), dispose: () => lifecycle.dispose() });
  }
  if (role.kind === "repository") {
    if (binding.data.dialect !== "postgres") throw new ControlError("CONTROL_ROLE_DIALECT");
    const data = binding.data;
    const storage = await createPostgresStorage({ url: z.url().parse(env["QUIRE_POSTGRES_URL"]) });
    try { await assertInstallationDatabase(storage.db, data.database.identity); }
    catch (error) { await storage.close(); throw error; }
    const branches = new PostgresBranchCoordinator(storage.uow, systemClock);
    let server: Awaited<ReturnType<typeof startRepositoryServer>> | undefined;
    const lifecycle = new PreparedLifecycle(async () => {
      permitActivation();
      const endpoint = new URL(data.repository.endpoint);
      server = await startRepositoryServer({
        ...storage, branches, clock: systemClock, admission: storage.admission,
        volume: data.repository.volume, token: z.string().min(32).parse(env["QUIRE_REPOSITORY_TOKEN"]),
        hostname: endpoint.hostname, port: Number(endpoint.port),
      });
    }, async () => { await server?.close(); await branches.close(); await storage.close(); });
    return observed({
      check: () => verifyRuntimeSchema(storage.db, inventory.migrations),
      activate: () => lifecycle.activate(), dispose: () => lifecycle.dispose(),
    });
  }
  const registrations = role.kind === "ssh" ? sshModules.map(({ migrations: _migrations, ...module }) => module) : [];
  const options: RuntimeOptions = { foundation: inventory.migrations, modules: registrations, ...adapterOptions };
  const prepared = await prepareRuntime(config, options);
  const workerId = workerRequest?.workerId ?? role.workerId;
  const environmentIds = workerRequest?.environmentIds ?? role.environmentIds;
  const allowedEnvironmentIds = role.environmentIds;
  let environments: readonly Environment[] | undefined;
  if (role.kind === "worker") {
    try {
      if (!workerId || !environmentIds?.length ||
          allowedEnvironmentIds && environmentIds.some(id => !allowedEnvironmentIds.includes(id))) {
        throw new ControlError("CONTROL_WORKER_CONFIG_REQUIRED");
      }
      environments = await workerEnvironments(binding, env, environmentIds);
    } catch (error) { await prepared.dispose(); throw error; }
  }
  let runtime: Runtime | undefined;
  let bridge: Awaited<ReturnType<typeof startSshBridge>> | undefined;
  let controller: WorkerController | undefined;
  let worker: Promise<void> | undefined;
  let workerFailure: unknown;
  const abort = new AbortController();
  const lifecycle = new PreparedLifecycle(async () => {
    permitActivation();
    if (role.kind === "worker") {
      if (!role.coordinator || !workerId || !environmentIds || !environments) throw new ControlError("CONTROL_WORKER_CONFIG_REQUIRED");
      const bearer = createHmac("sha256", Buffer.from(z.string().parse(env["QUIRE_SECRET_KEY"]), "hex"))
        .update("quire:compiler:worker:v1").digest("hex");
      worker = runRemoteWorker({ baseUrl: role.coordinator, bearer, workerId,
        environmentIds, environments, signal: abort.signal });
      void worker.catch(error => {
        console.error("installation.worker.run.failed", error);
        workerFailure = error;
        session.channel.close();
      });
      return;
    }
    runtime = await prepared.activate();
    if (role.kind === "ssh") {
      if (!role.sshClientFile || !role.sshEntrypoint ||
          !inventory.assets.some(asset => asset.path === role.sshEntrypoint)) throw new ControlError("CONTROL_SSH_CONFIG_REQUIRED");
      const client = await readClient(join(dataRoot, role.sshClientFile));
      const projects = runtime.services.get("projects");
      if (!(projects instanceof CoreProjects)) throw new ControlError("CONTROL_SSH_PROJECTS_REQUIRED");
      bridge = await startSshBridge(new GitRepository(projects), {
        token: client.token, clientFile: join(dataRoot, role.sshClientFile),
        command: [process.execPath, resolve(binding.release.target, role.sshEntrypoint)],
        port: role.port, session: serveGitSession,
      });
    } else {
      if (!role.coordinator) throw new ControlError("CONTROL_WORKER_CONFIG_REQUIRED");
      const bearer = createHmac("sha256", runtime.secretKey).update("quire:compiler:worker:v1").digest("hex");
      controller = new WorkerController({ ...runtime, routes: runtime.routes.forLane("O") }, {
        coordinator: role.coordinator, bearer, ...(role.environmentIds ? { environmentIds: role.environmentIds } : {}),
      });
      controller.addEventListener("failure", () => session.channel.close(), { once: true });
      await controller.start();
    }
  }, async () => {
    abort.abort();
    await bridge?.close();
    await controller?.close();
    if (worker) {
      try { await worker; }
      catch (error) { if (!(error instanceof Error && error.name === "AbortError")) workerFailure = error; }
    }
    await prepared.dispose();
    if (workerFailure) throw workerFailure;
  });
  return observed({ check: prepared.check, activate: () => lifecycle.activate(), dispose: () => lifecycle.dispose() });
}
