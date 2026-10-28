import { Database } from "bun:sqlite";
import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { IdSchema, InstantSchema } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import { applicationMigrations } from "../../../../apps/server/src/migrations";
import { seed } from "../../../../scripts/seed";
import { fixtureIds } from "../../../fixtures/foundation";
import { ControlStore } from "../../../../services/operations/installation/control-store";
import { AcceptedReleaseSchema, BindingSchema, InstallationStateSchema } from "../../../../services/operations/installation/model";
import { SystemdDriverConfigSchema } from "../../../../services/operations/installation/driver-config";
import { ExecutionLaunchSchema } from "../../../../services/operations/installation/execution-model";
import { canonicalJson, controlDigest, requestDigest } from "../../../../services/operations/installation/protocol";
import { handleControl, LaunchPermitSchema, listenControl } from "../../../../services/operations/installation/controller-server";
import type { ControlChannel } from "../../../../services/operations/installation/controller-server";
import { cgroupPids, command, inspectUnit } from "../../../../services/operations/installation/systemd-process";
import { dockerCommand, removeOwnedContainer } from "../../../../services/operations/installation/execution-docker";
import { removeExecutionFiles } from "../../../../services/operations/installation/execution-source";

export const id = () => IdSchema.parse(crypto.randomUUID());
export const limits = { wallSeconds: 120, memoryBytes: 1073741824, processes: 128, workspaceBytes: 536870912 };
const now = () => InstantSchema.parse(new Date().toISOString());
async function bundle(path: string) {
  const built = await Bun.build({ entrypoints: [resolve(path)], target: "bun" });
  if (!built.success || !built.outputs[0]) throw new Error(built.logs.map(log => log.message).join("\n"));
  return built.outputs[0].text();
}
export async function executionFixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-p9-supervisor-"));
  const installationId = `p9${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const roots = { control: join(root, "control"), sockets: join(root, "ipc"), app: join(root, "app"),
    data: join(root, "data"), archives: join(root, "archives"), restore: join(root, "restore"), stable: join(root, "controller") };
  for (const path of Object.values(roots)) await mkdir(path, { mode: 0o700 });
  await mkdir(join(roots.control, "secrets"), { mode: 0o700 });
  await mkdir(join(roots.control, "executions"), { mode: 0o700 });
  const controllerUnit = `quire-${installationId}-controller.service`;
  const helperUnit = `quire-${installationId}-helper.service`;
  const roles = ["api-a", "api-b"].map(role => ({ role, unit: `quire-${installationId}-${role}.service`, activators: [] }));
  const units = [controllerUnit, helperUnit, ...roles.map(role => role.unit)];
  await writeFile(join(root, "owned-manifest.json"), canonicalJson({ root, installationId, units }), { mode: 0o600 });
  const executable = join(roots.stable, "bun");
  await copyFile(await realpath("./node_modules/.bin/bun"), executable); await chmod(executable, 0o500);
  const script = join(roots.stable, "main.js");
  await writeFile(script, await bundle("tests/operations/installation/supervisor-execution/main.ts"), { mode: 0o400 });
  const roleBytes = await bundle("tests/operations/installation/supervisor-execution/release.ts");
  const imageProcess = Bun.spawn(["/usr/bin/docker", "image", "inspect", "quire-p2o-environments:st_01a17c2c", "--format", "{{.Id}}"],
    { stdout: "pipe", stderr: "pipe" });
  const imageOutput = await new Response(imageProcess.stdout).text();
  if (await imageProcess.exited !== 0) throw new Error(await new Response(imageProcess.stderr).text());
  const image = z.string().regex(/^sha256:[0-9a-f]{64}$/).parse(imageOutput.trim());
  const executionProfiles = [
    { id: "native", roles: ["api-a", "api-b"], kinds: ["compile", "environment-metadata", "environment-confinement"],
      backend: "bwrap", limits, maxConcurrent: 4 },
    { id: "docker", roles: ["api-a", "api-b"], kinds: ["compile", "environment-metadata", "environment-confinement",
      "environment-fixture", "environment-fonts", "environment-build"], backend: "docker", image, limits, maxConcurrent: 4,
      mirrors: ["https://archive.ubuntu.com/ubuntu/"] },
  ];
  const roleMetadata = canonicalJson({ installationId, executionProfiles,
    roles: roles.map(role => ({ role: role.role, kind: "api" })) });
  const migrations = await applicationMigrations();
  const releaseRoot = join(roots.app, "releases/prior");
  await mkdir(releaseRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(releaseRoot, "main.js"), roleBytes, { mode: 0o400 });
  await writeFile(join(releaseRoot, "installation-roles.json"), roleMetadata, { mode: 0o400 });
  const assets = [{ path: "main.js", digest: controlDigest(roleBytes) },
    { path: "installation-roles.json", digest: controlDigest(roleMetadata) }];
  await writeFile(join(releaseRoot, "installation-runtime.json"), canonicalJson({ migrations, assets }), { mode: 0o400 });
  await writeFile(join(roots.app, ".quire-update-root"), installationId, { mode: 0o400 });
  await symlink("releases/prior", join(roots.app, "current"));
  const hash = controlDigest("p9-native-fixture");
  const release = { target: releaseRoot, entrypoint: "main.js", releaseId: id(), version: "1.0.0", sequence: 1,
    manifestDigest: hash, packageDigest: hash };
  const signer = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  const signerPath = join(roots.control, "secrets/archive.pem");
  await writeFile(signerPath, signer, { mode: 0o600 });
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const bindings = [];
  for (const name of ["source", "fresh-one", "fresh-two", "fresh-three"]) {
    const dataRoot = join(roots.data, name);
    await mkdir(dataRoot, { mode: 0o700 });
    await writeFile(join(dataRoot, "secret.key"), secret, { mode: 0o600 });
    await writeFile(join(dataRoot, "backup-signing.pem"), signer, { mode: 0o600 });
    for (const directory of ["backups", "restores"]) await mkdir(join(dataRoot, directory), { mode: 0o700 });
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: dataRoot, QUIRE_COMPILER_BACKEND: "docker" }), { foundation: migrations });
    try { if (name === "source") { await seed(runtime, "p9-owned-execution-fixture"); await runtime.db.run("UPDATE o_worker_policy SET maximum=0,requested=0 WHERE id=1"); } }
    finally { await runtime.close(); }
    bindings.push(BindingSchema.parse({ release, data: { dialect: "sqlite", generationId: id(), dataRoot } }));
  }
  const prior = BindingSchema.parse(bindings[0]);
  const config = SystemdDriverConfigSchema.parse({
    driver: "systemd-local-v1", installationId, controlRoot: roots.control, socketRoot: roots.sockets,
    applicationRoot: roots.app, userRuntimeDir: process.env["XDG_RUNTIME_DIR"], controllerUnit, helperUnit, roles,
    maintenanceRoots: [roots.data, roots.archives, roots.restore], maintenanceSecrets: [signerPath],
    execution: { root: join(roots.control, "executions"), dockerSocket: "/run/docker.sock" },
    launcher: { executable, executableDigest: controlDigest(await readFile(executable)), script,
      scriptDigest: controlDigest(await readFile(script)) }, requestTimeoutMs: 120000,
  });
  ControlStore.provision(join(roots.control, "control.sqlite"), InstallationStateSchema.parse({
    installationId, protocolVersion: 1, roleInventory: roles, roleInventoryDigest: controlDigest(canonicalJson(roles)),
    generation: 0, supervisorEpoch: id(), mode: "open", operationId: null, binding: prior, floor: { version: "1.0.0", sequence: 1 },
  })).close();
  const key = generateKeyPairSync("ed25519");
  const candidateId = id();
  const candidateMigrations = [...migrations, { id: "099-o-p9-proof",
    sql: "CREATE TABLE p9_upgrade_probe(value TEXT NOT NULL); INSERT INTO p9_upgrade_probe VALUES('migrated');" }];
  const packageBytes = Buffer.from(canonicalJson({ format: 1, entrypoint: "main.js", files: [
    { path: "main.js", data: Buffer.from(roleBytes).toString("base64"), executable: true },
    { path: "installation-roles.json", data: Buffer.from(roleMetadata).toString("base64"), executable: false },
    { path: "installation-runtime.json", data: Buffer.from(canonicalJson({ migrations: candidateMigrations, assets })).toString("base64"), executable: false },
  ] }));
  let signedFeed = "";
  const feed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    return new URL(request.url).pathname === "/package" ? new Response(packageBytes) : new Response(signedFeed, { headers: { "content-type": "application/json" } });
  } });
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const candidate = { id: candidateId, version: "2.0.0", sequence: 2, security: false, notes: "Real P9 health failure",
    expiresAt, compatibleSchema: [1], packageUrl: new URL("/package", feed.url).href,
    packageDigest: controlDigest(packageBytes), packageBytes: packageBytes.length };
  const payload = Buffer.from(canonicalJson({ expiresAt, releases: [candidate] }));
  signedFeed = canonicalJson({ payload: payload.toString("base64"), signature: sign(null, payload, key.privateKey).toString("base64") });
  const accepted = AcceptedReleaseSchema.parse({ ...candidate, manifestDigest: controlDigest(payload) });
  const requested = { releaseId: candidate.id, at: now(), autoSecurity: false };
  const update = { installationId, operationId: id(), actorId: fixtureIds.operator, key: "p9-update", request: requested, requestDigest: requestDigest(requested) };
  const credentialPath = join(roots.control, "secrets/operator.json");
  await writeFile(credentialPath, canonicalJson({ id: id(), installationId, channel: "operator",
    secret: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex") }), { mode: 0o600 });
  const configPath = join(roots.control, "installation.json");
  await writeFile(configPath, canonicalJson({
    driver: config, storage: { archiveRoot: roots.archives, restoreRoot: roots.restore, signerPath,
      retained: [prior], freshTargets: bindings.slice(1) },
    update: { feedUrl: new URL("/feed", feed.url).href, trustKeyPem: key.publicKey.export({ type: "spki", format: "pem" }),
      installRoot: roots.app, installId: installationId, currentVersion: "1.0.0", currentSequence: 1, schemaVersion: 1,
      window: { start: new Date(Date.now() - 60000).toISOString(), end: expiresAt }, allowLoopbackHttp: true },
    credentials: [{ path: credentialPath, role: null }],
  }), { mode: 0o600 });
  let controllerReady = Promise.withResolvers<ControlChannel>();
  const roleChannels = new Map<string, { channel: ControlChannel; permit: z.infer<typeof LaunchPermitSchema> }>();
  const harness = await listenControl(join(roots.sockets, "harness.sock"), channel => {
    handleControl(channel, async (method, input) => {
      if (method === "controller-ready") { controllerReady.resolve(channel); return { ready: true }; }
      if (method === "role-ready") {
        const { permit } = z.object({ permit: LaunchPermitSchema }).parse(input);
        roleChannels.set(permit.execution.role, { channel, permit }); return { ready: true };
      }
      throw new Error("Unexpected fixture message");
    });
  }, 1048576, 180000);
  void controllerReady.promise.catch(() => undefined);
  let controllerProcess: ReturnType<typeof Bun.spawn> | undefined;
  let controller: ControlChannel | undefined;
  let controllerOutput: Promise<string> | undefined;
  let startedOnce = false;
  console.info("P9_OWNED", canonicalJson({ root, units }));
  return {
    root, roots, config, prior, accepted, update, image,
    async start() {
      controllerReady = Promise.withResolvers<ControlChannel>();
      const pending = controllerReady;
      void pending.promise.catch(() => undefined);
      const timer = setTimeout(() => pending.reject(new Error("P9 controller readiness deadline")), 90000);
      try {
        const argv = startedOnce ? ["/usr/bin/systemctl", "--user", "--wait", "start", controllerUnit] :
          ["/usr/bin/systemd-run", "--user", "--quiet", "--wait", `--unit=${controllerUnit}`,
          "--service-type=exec", "--property=KillMode=control-group", "--property=SendSIGKILL=yes",
          executable, script, "controller", configPath, join(roots.sockets, "harness.sock")];
        startedOnce = true;
        const child = Bun.spawn(argv,
        { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        controllerProcess = child;
        controllerOutput = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]).then(parts => parts.join("\n"));
        const output = controllerOutput;
        void child.exited.then(async code => { if (code !== 0) pending.reject(new Error(`Controller exited ${code}: ${await output}`)); });
        controller = await pending.promise;
        return controller;
      } finally { clearTimeout(timer); }
    },
    role(name = "api-a") {
      const role = roleChannels.get(name);
      if (!role) throw new Error(`Role not ready: ${name}`);
      return role;
    },
    async killController() {
      await command(config, ["/usr/bin/systemctl", "--user", "kill", "--signal=SIGKILL", controllerUnit]);
      await controllerProcess?.exited;
    },
    async [Symbol.asyncDispose]() {
      const db = new Database(join(roots.control, "control.sqlite"), { readonly: true });
      let launches: z.infer<typeof ExecutionLaunchSchema>[] = [];
      try {
        if (db.query("SELECT name FROM sqlite_master WHERE name='execution_launches'").get()) {
          launches = z.array(z.object({ record_json: z.string() })).parse(db.query("SELECT record_json FROM execution_launches").all())
            .map(row => ExecutionLaunchSchema.parse(JSON.parse(row.record_json)));
        }
      } finally { db.close(); }
      for (const unit of [...units, ...launches.map(launch => launch.unit)]) {
        const before = await inspectUnit(config, unit);
        if (!["inactive", "failed"].includes(before.state)) await command(config, ["/usr/bin/systemctl", "--user", "stop", unit]);
        const after = await inspectUnit(config, unit);
        if ((before.cgroup && (await cgroupPids(before.cgroup)).length) ||
            (after.cgroup && (await cgroupPids(after.cgroup)).length)) throw new Error(`P9 unit remains populated: ${unit}`);
        if (after.state === "failed") await command(config, ["/usr/bin/systemctl", "--user", "reset-failed", unit]);
      }
      controller?.close();
      for (const launch of launches) if (launch.containerName) await removeOwnedContainer("/run/docker.sock", launch);
      for (const launch of launches) if (launch.result?.image) {
        const inspected = await dockerCommand("/run/docker.sock", ["image", "inspect", launch.result.image]);
        const ownedImage = z.array(z.object({ Config: z.object({ Labels: z.record(z.string(), z.string()) }) }))
          .length(1).parse(JSON.parse(inspected.stdout))[0];
        if (!ownedImage || ownedImage.Config.Labels["quire.installation"] !== installationId ||
            ownedImage.Config.Labels["quire.execution"] !== launch.id) throw new Error("Owned image identity changed");
        const removed = await dockerCommand("/run/docker.sock", ["image", "rm", `quire-${installationId}-environment:${launch.id}`]);
        if (removed.code !== 0) throw new Error(removed.stderr);
      }
      for (const launch of launches) await removeExecutionFiles(launch.root);
      await controllerProcess?.exited;
      for (const role of roleChannels.values()) role.channel.close();
      await harness.close(); await feed.stop(true);
      await rm(root, { recursive: true });
      if (await lstat(root).then(() => true, () => false)) throw new Error("P9 root survived cleanup");
      console.info("P9_CLEANED", canonicalJson({ root, units: [...units, ...launches.map(launch => launch.unit)],
        containers: launches.flatMap(launch => launch.containerId ? [launch.containerId] : []),
        images: launches.flatMap(launch => launch.result?.image ? [launch.result.image] : []), output: await controllerOutput ?? "" }));
    },
  };
}
