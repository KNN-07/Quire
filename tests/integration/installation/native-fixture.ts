import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { EnvironmentSchema, IdSchema, InstantSchema, OperationSchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import { applicationMigrations } from "../../../apps/server/src/migrations";
import { seed } from "../../../scripts/seed";
import { ControlStore } from "../../../services/operations/installation/control-store";
import { BindingSchema, ExecutionIdentitySchema, InstallationStateSchema } from "../../../services/operations/installation/model";
import type { InstallationBinding, UpdateOperationRow } from "../../../services/operations/installation/model";
import { SystemdDriverConfigSchema } from "../../../services/operations/installation/driver-config";
import { canonicalJson, controlDigest, signControlCommand } from "../../../services/operations/installation/protocol";
import type { ControlCommand, ControlCredential } from "../../../services/operations/installation/protocol";
import { createUnixUpdateTransport, handleControl, listenControl } from "../../../services/operations/installation/controller-server";
import { cgroupPids, command, inspectUnit, processIdentity } from "../../../services/operations/installation/systemd-process";
import { InstallationRolesSchema } from "../../../services/operations/installation/binding";
import { defaultLimits } from "../../../workers/compiler/sandbox";
import { provisionAcceptedEnvironment } from "./environment-fixture";

export const password = "owned-installation-integration-2026";
export const origin = "http://localhost:5173";
const id = () => IdSchema.parse(crypto.randomUUID());
const now = () => InstantSchema.parse(new Date().toISOString());
async function bundle(path: string) {
  const result = await Bun.build({ entrypoints: [resolve(path)], target: "bun" });
  if (!result.success || !result.outputs[0]) throw new Error(result.logs.map(log => log.message).join("\n"));
  return result.outputs[0].text();
}
async function unusedPort() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
  const port = server.port;
  await server.stop(true);
  if (!port) throw new Error("Expected an allocated loopback port");
  return port;
}
export async function nativeInstallation(options: {
  readonly migrationSql?: string;
  readonly healthBarrier?: boolean;
  readonly candidatePortConflict?: boolean;
  readonly workerEnvironment?: Environment;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "quire-installation-integration-"));
  let stopFeed: (() => Promise<void>) | undefined;
  let closeBarrier: (() => Promise<void>) | undefined;
  try {
  const installationId = `integration${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const controllerUnit = `quire-${installationId}-controller.service`;
  const helperUnit = `quire-${installationId}-helper.service`;
  const environment = options.workerEnvironment && EnvironmentSchema.parse(options.workerEnvironment);
  if (environment && (environment.backend !== "docker" || !environment.available)) throw new Error("Expected accepted Docker environment");
  const names = [...(environment ? ["worker-controller", "ssh"] : []), "api-a", "api-b"];
  const roles = names.map(role => ({ role, unit: `quire-${installationId}-${role}.service`, activators: [] }));
  const units = [...roles.map(role => role.unit), helperUnit, controllerUnit];
  await writeFile(join(root, "owned-manifest.json"), canonicalJson({ root, installationId, units }), { mode: 0o600 });
  const roots = { control: join(root, "control"), sockets: join(root, "sockets"), app: join(root, "app"),
    data: join(root, "data"), archives: join(root, "archives"), restore: join(root, "restore"), stable: join(root, "controller") };
  for (const path of Object.values(roots)) await mkdir(path, { mode: 0o700 });
  await mkdir(join(roots.control, "secrets"), { mode: 0o700 });
  await mkdir(join(roots.app, "releases"), { mode: 0o700 });
  const priorRoot = join(roots.app, "releases/prior");
  await mkdir(join(priorRoot, "bin"), { recursive: true, mode: 0o700 });
  const executable = join(roots.stable, "bun");
  await copyFile(await realpath("./node_modules/.bin/bun"), executable);
  await chmod(executable, 0o500);
  const script = join(roots.stable, "installation.js");
  await writeFile(script, await bundle("apps/server/src/installation-main.ts"), { mode: 0o400 });
  const roleBytes = await bundle("apps/server/src/installation-role.ts");
  const migrations = await applicationMigrations();
  const ports = await Promise.all(roles.map(() => unusedPort()));
  const apiPort = ports[names.indexOf("api-a")];
  const sshPort = ports[names.indexOf("ssh")];
  const coordinator = `http://127.0.0.1:${apiPort}`;
  const sshToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const sshBytes = environment ? await bundle("scripts/ops/ssh.ts") : null;
  const extraFiles = sshBytes ? [{ path: "ssh.js", bytes: sshBytes }] : [];
  const manifest = InstallationRolesSchema.parse({ installationId, controlSocket: join(roots.sockets, "control.sock"),
    ...(environment ? { executionProfiles: [
      { id: "native-tools", roles: ["api-a", "api-b", "compiler-worker"], backend: "bwrap",
        kinds: ["compile", "synctex-forward", "synctex-reverse", "pdf-validate", "environment-metadata",
          "pdf-diff-render", "pdf-diff-compile"], limits: defaultLimits, maxConcurrent: 2 },
      { id: "api-docker-default", roles: ["api-a", "api-b"], backend: "docker", image: environment.rootOrImageDigest,
        profile: "default", kinds: ["compile", "pdf-validate", "environment-metadata", "environment-confinement",
          "environment-fixture", "environment-fonts", "environment-build"],
        limits: { ...defaultLimits, wallSeconds: 900 }, maxConcurrent: 2, mirrors: ["https://archive.ubuntu.com/ubuntu"] },
      { id: "worker-docker-default", roles: ["compiler-worker"], backend: "docker", image: environment.rootOrImageDigest,
        profile: "default", kinds: ["compile", "pdf-validate", "environment-metadata", "environment-confinement", "environment-fixture"],
        limits: defaultLimits, maxConcurrent: 2 },
      { id: "worker-pool", roles: ["worker-controller"], backend: "worker", kinds: ["worker"],
        workerRole: "compiler-worker", limits: { ...defaultLimits, wallSeconds: 86400, memoryBytes: 2147483648 }, maxConcurrent: 1 },
    ] } : {}),
    roles: [...roles.map((role, i) => ({ role: role.role,
      kind: role.role === "ssh" ? "ssh" : role.role === "worker-controller" ? "worker-controller" : "api",
      host: "127.0.0.1", port: ports[i], publicUrl: origin, compilerBackend: "docker",
      ...(role.role.startsWith("api-") ? { apiCredentialFile: `${role.role}.json` } : {}),
      ...(role.role === "ssh" ? { sshClientFile: "ssh-client.json", sshEntrypoint: "ssh.js" } : {}),
      ...(role.role === "worker-controller" && environment ? { coordinator, environmentIds: [environment.id] } : {}),
    })), ...(environment ? [{ role: "compiler-worker", kind: "worker", host: "127.0.0.1",
      port: apiPort, publicUrl: origin, compilerBackend: "docker", coordinator, environmentIds: [environment.id] }] : [])] });
  const roleMetadata = canonicalJson(manifest);
  const assets = [{ path: "bin/installation-role.js", digest: controlDigest(roleBytes) },
    { path: "installation-roles.json", digest: controlDigest(roleMetadata) },
    ...extraFiles.map(file => ({ path: file.path, digest: controlDigest(file.bytes) }))];
  for (const file of extraFiles) await writeFile(join(priorRoot, file.path), file.bytes, { mode: 0o400 });
  await writeFile(join(priorRoot, "bin/installation-role.js"), roleBytes, { mode: 0o400 });
  await writeFile(join(priorRoot, "installation-roles.json"), roleMetadata, { mode: 0o400 });
  await writeFile(join(priorRoot, "installation-runtime.json"), canonicalJson({ migrations, assets }), { mode: 0o400 });
  await writeFile(join(roots.app, ".quire-update-root"), installationId, { mode: 0o400 });
  await symlink("releases/prior", join(roots.app, "current"));
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const signer = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  const credentials = roles.filter(role => role.role.startsWith("api-")).map(role => ({ role: role.role, credential: {
    id: id(), installationId, channel: "api" as const, secret: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
  } }));
  const signerPath = join(roots.control, "secrets/archive.pem");
  await writeFile(signerPath, signer, { mode: 0o600 });
  const hash = controlDigest("installation-integration-baseline");
  const priorRelease = { target: priorRoot, entrypoint: "bin/installation-role.js", releaseId: id(),
    version: "1.0.0", sequence: 1, manifestDigest: hash, packageDigest: hash };
  const bindings: InstallationBinding[] = [];
  for (const name of ["source", "fresh-one", "fresh-two", "fresh-three"]) {
    const dataRoot = join(roots.data, name);
    await mkdir(dataRoot, { mode: 0o700 });
    await writeFile(join(dataRoot, "secret.key"), secret, { mode: 0o600 });
    await writeFile(join(dataRoot, "backup-signing.pem"), signer, { mode: 0o600 });
    await writeFile(join(dataRoot, ".quire-installation.json"), canonicalJson({ installationId }), { mode: 0o400 });
    for (const item of credentials) await writeFile(join(dataRoot, `${item.role}.json`), canonicalJson(item.credential), { mode: 0o600 });
    if (environment) await writeFile(join(dataRoot, "ssh-client.json"),
      canonicalJson({ url: `http://127.0.0.1:${sshPort}`, token: sshToken }), { mode: 0o600 });
    for (const directory of ["backups", "restores"]) await mkdir(join(dataRoot, directory), { mode: 0o700 });
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: dataRoot, QUIRE_COMPILER_BACKEND: "docker" }), { foundation: migrations });
    try {
      if (name === "source") {
        await seed(runtime, password);
        if (environment) {
          await provisionAcceptedEnvironment(runtime, environment);
        } else await runtime.db.run("UPDATE o_worker_policy SET minimum=0,maximum=0,requested=0 WHERE id=1");
      }
    } finally { await runtime.close(); }
    bindings.push(BindingSchema.parse({ release: priorRelease, data: { dialect: "sqlite", generationId: id(), dataRoot } }));
  }
  const prior = BindingSchema.parse(bindings[0]);
  const executionRoot = join(roots.control, "executions");
  if (environment) await mkdir(executionRoot, { mode: 0o700 });
  const config = SystemdDriverConfigSchema.parse({
    driver: "systemd-local-v1", installationId, controlRoot: roots.control, socketRoot: roots.sockets,
    applicationRoot: roots.app, userRuntimeDir: process.env["XDG_RUNTIME_DIR"], controllerUnit, helperUnit, roles,
    maintenanceRoots: [roots.data, roots.archives, roots.restore], maintenanceSecrets: [signerPath],
    launcher: { executable, executableDigest: controlDigest(await readFile(executable)), script, scriptDigest: controlDigest(await readFile(script)) },
    requestTimeoutMs: 60000,
    ...(environment ? { execution: { root: executionRoot, dockerSocket: await realpath("/var/run/docker.sock") } } : {}),
  });
  const store = ControlStore.provision(join(roots.control, "control.sqlite"), InstallationStateSchema.parse({
    installationId, protocolVersion: 1, roleInventory: roles, roleInventoryDigest: controlDigest(canonicalJson(roles)),
    generation: 0, supervisorEpoch: id(), mode: "open", operationId: null, binding: prior, floor: { version: "1.0.0", sequence: 1 },
  }));
  store.close();
  const operator: ControlCredential = { id: id(), installationId, channel: "operator", secret: crypto.getRandomValues(new Uint8Array(32)) };
  const operatorPath = join(roots.control, "secrets/operator.json");
  await writeFile(operatorPath, canonicalJson({ ...operator, secret: Buffer.from(operator.secret).toString("hex") }), { mode: 0o600 });
  const releaseKey = generateKeyPairSync("ed25519");
  const candidateId = id();
  const candidateMigrations = [...migrations, { id: "099-o-installation-proof",
    sql: options.migrationSql ?? "CREATE TABLE installation_update_probe(value TEXT NOT NULL); INSERT INTO installation_update_probe VALUES('real-signed-migration');" }];
  const preparedHealth = Promise.withResolvers<{
    execution: z.infer<typeof ExecutionIdentitySchema>; binding: InstallationBinding; pid: number;
  }>();
  void preparedHealth.promise.catch(() => undefined);
  const resumeHealth = Promise.withResolvers<void>();
  const healthSocket = join(roots.sockets, "health.sock");
  if (options.healthBarrier) {
    const listener = await listenControl(healthSocket, (channel, peer) => {
      handleControl(channel, async (method, value) => {
        try {
          if (method !== "prepared-health-ready") throw new Error("Unexpected signed health barrier command");
          const message = z.object({ execution: ExecutionIdentitySchema, binding: BindingSchema,
            pid: z.number(), readiness: z.object({ database: z.literal("sqlite"), migrations: z.array(z.unknown()) }) }).parse(value);
          const process = await processIdentity(peer);
          const unit = await inspectUnit(config, message.execution.unit);
          // The payload PID is namespace-local; SO_PEERCRED supplies the host
          // PID whose actual cgroup/invocation must match the signed cohort.
          if (peer.uid !== globalThis.process.getuid?.() || message.execution.installationId !== installationId ||
              message.execution.role !== "api-a" || message.execution.purpose !== "prepared" ||
              message.execution.unit !== roles.find(role => role.role === "api-a")?.unit || message.execution.invocationId !== unit.invocationId ||
              process.cgroup !== unit.cgroup || message.binding.release.releaseId !== candidateId) {
            throw new Error("Health peer identity mismatch");
          }
          console.info("INSTALLATION_PREPARED_HEALTH_PROTOCOL", canonicalJson({ ...message, peer, process, unit }));
          preparedHealth.resolve(message);
          await resumeHealth.promise;
          return { observed: true };
        } catch (error) { preparedHealth.reject(error); throw error; }
      });
    });
    closeBarrier = async () => { resumeHealth.resolve(); await listener.close(); };
  }
  const candidateRole = options.healthBarrier ? await bundle("tests/integration/installation/candidate-release.ts") : roleBytes;
  // Sequential preflight can bind either listener, but the simultaneously
  // prepared live cohort must observe the real EADDRINUSE construction failure.
  const candidateMetadata = options.candidatePortConflict
    ? canonicalJson({ ...manifest, roles: manifest.roles.map(role => ({ ...role, port: ports[1] })) })
    : roleMetadata;
  const healthMetadata = canonicalJson({ socket: healthSocket });
  const candidateAssets = [{ path: "bin/installation-role.js", digest: controlDigest(candidateRole) },
    { path: "installation-roles.json", digest: controlDigest(candidateMetadata) },
    ...extraFiles.map(file => ({ path: file.path, digest: controlDigest(file.bytes) })),
    ...(options.healthBarrier ? [{ path: "installation-health.json", digest: controlDigest(healthMetadata) }] : [])];
  const packageBytes = Buffer.from(JSON.stringify({ format: 1, entrypoint: "bin/installation-role.js", files: [
    { path: "bin/installation-role.js", data: Buffer.from(candidateRole).toString("base64"), executable: true },
    { path: "installation-roles.json", data: Buffer.from(candidateMetadata).toString("base64"), executable: false },
    ...extraFiles.map(file => ({ path: file.path, data: Buffer.from(file.bytes).toString("base64"), executable: true })),
    { path: "installation-runtime.json", data: Buffer.from(canonicalJson({ migrations: candidateMigrations, assets: candidateAssets })).toString("base64"), executable: false },
    ...(options.healthBarrier ? [{ path: "installation-health.json", data: Buffer.from(healthMetadata).toString("base64"), executable: false }] : []),
  ] }));
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  let feedBytes = "";
  const feed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    return new URL(request.url).pathname === "/package" ? new Response(packageBytes) : Response.json(JSON.parse(feedBytes));
  } });
  stopFeed = () => feed.stop(true);
  const release = { id: candidateId, version: "2.0.0", sequence: 2, security: false, notes: "Actual isolated installation proof",
    expiresAt, compatibleSchema: [1], packageUrl: new URL("/package", feed.url).href,
    packageDigest: controlDigest(packageBytes), packageBytes: packageBytes.length };
  const payload = Buffer.from(JSON.stringify({ expiresAt, releases: [release] }));
  feedBytes = JSON.stringify({ payload: payload.toString("base64"), signature: sign(null, payload, releaseKey.privateKey).toString("base64") });
  const configPath = join(roots.control, "installation.json");
  await writeFile(configPath, canonicalJson({
    driver: config, storage: { archiveRoot: roots.archives, restoreRoot: roots.restore, signerPath, retained: [prior], freshTargets: bindings.slice(1) },
    update: { feedUrl: new URL("/feed", feed.url).href, trustKeyPem: releaseKey.publicKey.export({ type: "spki", format: "pem" }),
      installRoot: roots.app, installId: installationId, currentVersion: "1.0.0", currentSequence: 1, schemaVersion: 1,
      window: { start: new Date(Date.now() - 60000).toISOString(), end: expiresAt }, allowLoopbackHttp: true },
    credentials: [{ path: operatorPath, role: null }, ...credentials.map(item => ({
      path: join(prior.data.dialect === "sqlite" ? prior.data.dataRoot : "", `${item.role}.json`), role: item.role,
    }))],
  }), { mode: 0o600 });
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let output: Promise<string> | undefined;
  const subscriptions = new Set<() => void>();
  const transport = createUnixUpdateTransport(join(roots.sockets, "control.sock"));
  const control = (request: ControlCommand) => transport.send(signControlCommand({
    protocolVersion: 1, installationId, credentialId: operator.id, requestId: id(), issuedAt: now(), command: request,
  }, operator));
  async function start() {
    const ready = Promise.withResolvers<void>();
    const observer = watch(roots.control, (_event, file) => {
      if (file !== "controller-ready.json") return;
      void readFile(join(roots.control, file), "utf8").then(bytes => {
        const current = z.object({ pid: z.number() }).parse(JSON.parse(bytes));
        if (current.pid !== previousPid) ready.resolve();
      }).catch(ready.reject);
    });
    const previousPid = await readFile(join(roots.control, "controller-ready.json"), "utf8")
      .then(bytes => z.object({ pid: z.number() }).parse(JSON.parse(bytes)).pid, () => 0);
    const timeout = setTimeout(() => ready.reject(new Error("Actual controller startup timed out")), 90000);
    try {
      const controller = Bun.spawn(["/usr/bin/systemd-run", "--user", "--quiet", "--wait", "--pipe", "--collect",
        `--unit=${controllerUnit}`, "--service-type=exec", "--property=KillMode=control-group",
        "--property=SendSIGKILL=yes", "--property=Restart=no", executable, script, "controller", configPath],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      child = controller;
      output = Promise.all([new Response(controller.stdout).text(), new Response(controller.stderr).text()]).then(parts => parts.join("\n"));
      void controller.exited.then(async code => { if (code !== 0) ready.reject(new Error(`Controller exit ${code}: ${await output}`)); });
      await ready.promise;
    } finally { clearTimeout(timeout); observer.close(); }
  }
  function receiptWhen(predicate: (row: UpdateOperationRow) => boolean) {
    const result = Promise.withResolvers<UpdateOperationRow>();
    let pending = false;
    let dirty = false;
    const observer = watch(roots.control, (_event, file) => { if (file?.startsWith("control.sqlite")) void check(); });
    const timeout = setTimeout(() => { observer.close(); result.reject(new Error("Durable update receipt event timed out")); }, 120000);
    const cancel = () => result.reject(new Error("Owned receipt subscription closed"));
    subscriptions.add(cancel);
    const close = () => { observer.close(); clearTimeout(timeout); subscriptions.delete(cancel); };
    void result.promise.then(close, close);
    async function check() {
      if (pending) { dirty = true; return; }
      pending = true;
      try {
        do {
          dirty = false;
          const rows = z.array(z.object({ actorId: IdSchema, operation: OperationSchema,
            createdAt: InstantSchema, updatedAt: InstantSchema })).parse(await control({ method: "list", input: { limit: 100 } }));
          for (const row of rows) {
            if (predicate(row)) { observer.close(); clearTimeout(timeout); result.resolve(row); return; }
          }
        } while (dirty);
      } catch (error) { observer.close(); clearTimeout(timeout); result.reject(error); }
      finally { pending = false; }
    }
    void check();
    return result.promise;
  }
  function activatedAfter(generation: number) {
    const result = Promise.withResolvers<void>();
    const seen = new Set<string>();
    const observers = bindings.flatMap(binding => {
      if (binding.data.dialect !== "sqlite") return [];
      const dataRoot = binding.data.dataRoot;
      return [watch(dataRoot, (_event, file) => {
        if (!file?.startsWith(".installation-active-") || !file.endsWith(".json")) return;
        void readFile(join(dataRoot, file), "utf8").then(bytes => {
          const value = z.object({ execution: z.object({ generation: z.number(), role: z.string() }) }).parse(JSON.parse(bytes));
          if (value.execution.generation > generation) seen.add(value.execution.role);
          if (roles.every(role => seen.has(role.role))) {
            for (const observer of observers) observer.close();
            clearTimeout(timeout);
            result.resolve();
          }
        }).catch(result.reject);
      })];
    });
    const timeout = setTimeout(() => {
      for (const observer of observers) observer.close();
      result.reject(new Error("Actual role activation event timed out"));
    }, 120000);
    const cancel = () => result.reject(new Error("Owned activation subscription closed"));
    subscriptions.add(cancel);
    const close = () => {
      for (const observer of observers) observer.close();
      clearTimeout(timeout);
      subscriptions.delete(cancel);
    };
    void result.promise.then(close, close);
    void result.promise.catch(() => undefined);
    return result.promise;
  }
  console.info("INSTALLATION_INTEGRATION_OWNED", canonicalJson({ root, units }));
  return {
    root, roots, prior, config, ports, apiPort, sshPort, environment, sshToken, manifest, release, control, start, receiptWhen, activatedAfter,
    preparedHealth: preparedHealth.promise, releaseHealth: () => resumeHealth.resolve(),
    async operatorCommand(mode: "status" | "recover", recovery?: { installationId: string; operationId: string }) {
      const args = [executable, script, mode, roots.sockets, operatorPath,
        ...(recovery ? [recovery.installationId, recovery.operationId] : [])];
      const process = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([
        process.exited, new Response(process.stdout).text(), new Response(process.stderr).text(),
      ]);
      return { code, stdout, stderr };
    },
    async killController() {
      await command(config, ["/usr/bin/systemctl", "--user", "kill", "--signal=SIGKILL", controllerUnit]);
      await child?.exited;
      return output;
    },
    async [Symbol.asyncDispose]() {
      for (const cancel of subscriptions) cancel();
      for (const unit of [controllerUnit, ...units.filter(candidate => candidate !== controllerUnit)]) {
        const state = await inspectUnit(config, unit);
        if (!["inactive", "failed"].includes(state.state)) await command(config, ["/usr/bin/systemctl", "--user", "stop", unit]);
        const actual = await inspectUnit(config, unit);
        if (actual.cgroup && (await cgroupPids(actual.cgroup)).length) throw new Error(`Owned cgroup still populated: ${unit}`);
        if (actual.state === "failed") await command(config, ["/usr/bin/systemctl", "--user", "reset-failed", unit]);
      }
      await child?.exited;
      const protocol = await output;
      if (protocol) console.info("INSTALLATION_CONTROLLER_PROTOCOL", protocol);
      await closeBarrier?.();
      await feed.stop(true);
      await rm(root, { recursive: true });
      if (await lstat(root).then(() => true, () => false)) throw new Error("Owned integration root survived cleanup");
      console.info("INSTALLATION_INTEGRATION_CLEANED", root);
    },
  };
  } catch (error) {
    await closeBarrier?.();
    await stopFeed?.();
    await rm(root, { recursive: true });
    throw error;
  }
}
