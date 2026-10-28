import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { IdSchema, InstantSchema } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import { applicationMigrations } from "../../../apps/server/src/migrations";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";
import { Database } from "bun:sqlite";
import { candidateMigration } from "./supervisor-candidate-release";
import { ControlStore } from "../../../services/operations/installation/control-store";
import { AcceptedReleaseSchema, BindingSchema, InstallationStateSchema } from "../../../services/operations/installation/model";
import { canonicalJson, controlDigest, requestDigest, signControlCommand } from "../../../services/operations/installation/protocol";
import type { ControlCommand, ControlCredential } from "../../../services/operations/installation/protocol";
import { connectControl, createUnixUpdateTransport, handleControl, listenControl } from "../../../services/operations/installation/controller-server";
import type { ControlChannel } from "../../../services/operations/installation/controller-server";
import { command, inspectUnit, cgroupPids } from "../../../services/operations/installation/systemd-process";
import { SystemdDriverConfigSchema } from "../../../services/operations/installation/driver-config";

const id = () => IdSchema.parse(crypto.randomUUID());
const at = () => InstantSchema.parse(new Date().toISOString());
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-supervisor-"));
  const installationId = `proof${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const controllerUnit = `quire-${installationId}-controller.service`;
  const roleUnit = `quire-${installationId}-api.service`;
  const secondRoleUnit = `quire-${installationId}-api2.service`;
  const helperUnit = `quire-${installationId}-helper.service`;
  const unrelatedUnit = `quire-${installationId}-unrelated.service`;
  const roots = { control: join(root, "control"), sockets: join(root, "ipc"), app: join(root, "app"),
    data: join(root, "data"), archives: join(root, "archives"), restore: join(root, "restore") };
  for (const path of Object.values(roots)) await mkdir(path, { mode: 0o700 });
  const releaseRoot = join(roots.app, "prior");
  await mkdir(releaseRoot, { mode: 0o700 });
  const migrations = await applicationMigrations();
  const releaseBundle = await Bun.build({ entrypoints: [resolve("tests/operations/installation/supervisor-release.ts")], target: "bun" });
  if (!releaseBundle.success || !releaseBundle.outputs[0]) throw new Error("Release bundle failed");
  await writeFile(join(releaseRoot, "main.js"), await releaseBundle.outputs[0].text(), { mode: 0o400 });
  await writeFile(join(releaseRoot, "installation-runtime.json"), canonicalJson({
    migrations, assets: [{ path: "main.js", digest: controlDigest(await readFile(join(releaseRoot, "main.js"))) }],
  }), { mode: 0o600 });
  await symlink("prior", join(roots.app, "current"));
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const signer = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  const hash = controlDigest("supervisor-native-proof");
  const priorRelease = { target: releaseRoot, entrypoint: "main.js", releaseId: id(), version: "1.0.0",
    sequence: 1, manifestDigest: hash, packageDigest: hash };
  const bindings = [];
  let migrationLedger: readonly Record<string, unknown>[] = [];
  for (const name of ["source", "fresh", "rollback"]) {
    const dataRoot = join(roots.data, name);
    await mkdir(dataRoot, { mode: 0o700 });
    await writeFile(join(dataRoot, "secret.key"), Buffer.from(secret).toString("hex"), { mode: 0o600 });
    await writeFile(join(dataRoot, "backup-signing.pem"), signer, { mode: 0o600 });
    for (const directory of ["backups", "restores"]) await mkdir(join(dataRoot, directory), { mode: 0o700 });
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: dataRoot, QUIRE_COMPILER_BACKEND: "docker" }), { foundation: migrations });
    if (name === "source") migrationLedger = await runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
    if (name === "source") await seed(runtime, "owned-supervisor-source-2026");
    await runtime.close();
    bindings.push(BindingSchema.parse({ release: priorRelease, data: { dialect: "sqlite", generationId: id(), dataRoot } }));
  }
  const prior = BindingSchema.parse(bindings[0]);
  const roles = [{ role: "api", unit: roleUnit, activators: [] }, { role: "api", unit: secondRoleUnit, activators: [] }];
  const stable = join(root, "controller");
  await mkdir(stable, { mode: 0o700 });
  const executable = join(stable, "bun");
  await copyFile(await realpath("./node_modules/.bin/bun"), executable);
  await chmod(executable, 0o500);
  const script = join(stable, "launcher.js");
  const bundle = await Bun.build({ entrypoints: [resolve("tests/operations/installation/supervisor-launcher.ts")], target: "bun" });
  if (!bundle.success || !bundle.outputs[0]) throw new Error(`Launcher bundle failed: ${bundle.logs.map(item => item.message).join("\n")}`);
  await writeFile(script, await bundle.outputs[0].text(), { mode: 0o400 });
  await mkdir(join(roots.control, "secrets"), { mode: 0o700 });
  const signerPath = join(roots.control, "secrets/archive-signer.pem");
  await writeFile(signerPath, signer, { mode: 0o600 });
  const config = SystemdDriverConfigSchema.parse({
    driver: "systemd-local-v1", installationId, controlRoot: roots.control, socketRoot: roots.sockets,
    applicationRoot: roots.app, userRuntimeDir: process.env["XDG_RUNTIME_DIR"], controllerUnit, roles, helperUnit,
    maintenanceRoots: [roots.data, roots.archives, roots.restore], maintenanceSecrets: [signerPath],
    launcher: { executable, executableDigest: controlDigest(await readFile(executable)),
      script, scriptDigest: controlDigest(await readFile(script)) }, requestTimeoutMs: 30000,
  });
  const store = ControlStore.provision(join(roots.control, "control.sqlite"), InstallationStateSchema.parse({
    installationId, protocolVersion: 1, roleInventory: roles, roleInventoryDigest: controlDigest(canonicalJson(roles)),
    generation: 0, supervisorEpoch: id(), mode: "open", operationId: null, binding: prior, floor: { version: "1.0.0", sequence: 1 },
  }));
  store.close();
  const configPath = join(roots.control, "fixture.json");
  const operator: ControlCredential = { id: id(), installationId, channel: "operator", secret: crypto.getRandomValues(new Uint8Array(32)) };
  await writeFile(configPath, canonicalJson({ config, policy: { archiveRoot: roots.archives, restoreRoot: roots.restore,
    signerPath, retained: [prior], freshTargets: bindings.slice(1) },
  operator: { id: operator.id, secret: Buffer.from(operator.secret).toString("hex") } }), { mode: 0o600 });
  await writeFile(join(root, "owned-manifest.json"), canonicalJson({ root, units: [controllerUnit, roleUnit, secondRoleUnit, helperUnit, unrelatedUnit] }), { mode: 0o600 });
  let current: ControlChannel | undefined;
  let controllerExit: Promise<void> | undefined;
  let startedOnce = false;
  let waiter = Promise.withResolvers<ControlChannel>();
  const helperBarrier = Promise.withResolvers<void>();
  void waiter.promise.catch(() => undefined);
  const harness = await listenControl(join(roots.sockets, "harness.sock"), channel => {
    handleControl(channel, async method => {
      if (method === "helper-ready") { helperBarrier.resolve(); return { held: true }; }
      if (method !== "ready") throw new Error("Unexpected child command");
      current = channel;
      waiter.resolve(channel);
      return { accepted: true };
    });
  });
  async function start() {
    waiter = Promise.withResolvers<ControlChannel>();
    const pendingStart = waiter;
    void waiter.promise.catch(() => undefined);
    const timer = setTimeout(() => waiter.reject(new Error("Controller did not reach readiness")), 30000);
    try {
      const argv = startedOnce ? ["/usr/bin/systemctl", "--user", "--wait", "start", controllerUnit] :
        ["/usr/bin/systemd-run", "--user", "--quiet", "--wait", `--unit=${controllerUnit}`,
          "--service-type=exec", "--property=KillMode=control-group", "--property=Restart=no",
          executable, resolve("tests/operations/installation/supervisor-controller.ts"), configPath, join(roots.sockets, "harness.sock")];
      startedOnce = true;
      const child = Bun.spawn(argv,
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      controllerExit = child.exited.then(async code => {
        const messages = await output;
        if (code !== 0) pendingStart.reject(new Error(`Controller exited ${code}: ${messages.join("\n")}`));
      });
      return await waiter.promise;
    } finally { clearTimeout(timer); }
  }
  const release = AcceptedReleaseSchema.parse({
    id: id(), version: "2.0.0", sequence: 2, security: false, notes: "Owned proof", expiresAt: "2026-10-28T00:00:00.000Z",
    compatibleSchema: [1], packageUrl: "https://invalid.example/owned-proof", packageDigest: hash, packageBytes: 1, manifestDigest: hash,
  });
  const request = { releaseId: release.id, at: at(), autoSecurity: false };
  const update = { installationId, operationId: id(), actorId: fixtureIds.kien, key: "owned-lifecycle", request, requestDigest: requestDigest(request) };
  const candidateRoot = join(roots.app, "candidate");
  await mkdir(candidateRoot, { mode: 0o700 });
  const candidateBundle = await Bun.build({ entrypoints: [resolve("tests/operations/installation/supervisor-candidate-release.ts")], target: "bun" });
  if (!candidateBundle.success || !candidateBundle.outputs[0]) throw new Error("Candidate bundle failed");
  const candidateBytes = await candidateBundle.outputs[0].text();
  await writeFile(join(candidateRoot, "main.js"), candidateBytes, { mode: 0o400 });
  await writeFile(join(candidateRoot, "installation-runtime.json"), canonicalJson({
    migrations: [...migrations, candidateMigration], assets: [{ path: "main.js", digest: controlDigest(candidateBytes) }],
  }), { mode: 0o400 });
  const candidate = BindingSchema.parse({ release: { ...prior.release, target: candidateRoot, releaseId: release.id,
    version: release.version, sequence: release.sequence }, data: prior.data });
  console.info("SUPERVISOR_OWNED", canonicalJson({ root, units: [controllerUnit, roleUnit, secondRoleUnit, helperUnit, unrelatedUnit] }));
  return {
    root, config, roots, prior, candidate, update, release, start, unrelatedUnit, migrationLedger, operator, helperBarrier: helperBarrier.promise,
    control(input: ControlCommand) {
      return createUnixUpdateTransport(join(roots.sockets, "control.sock")).send(signControlCommand({
        protocolVersion: 1, installationId, credentialId: operator.id, requestId: id(), issuedAt: at(), command: input,
      }, operator));
    },
    async killController() {
      const closed = current?.closed;
      await command(config, ["/usr/bin/systemctl", "--user", "kill", "--signal=SIGKILL", controllerUnit]);
      await closed;
      await controllerExit;
    },
    async [Symbol.asyncDispose]() {
      for (const unit of [roleUnit, secondRoleUnit, helperUnit, controllerUnit, unrelatedUnit]) {
        const before = await inspectUnit(config, unit);
        if (!["inactive", "failed"].includes(before.state)) await command(config, ["/usr/bin/systemctl", "--user", "stop", unit]);
        const actual = await inspectUnit(config, unit);
        expect(["inactive", "failed"]).toContain(actual.state);
        if (actual.cgroup) expect(await cgroupPids(actual.cgroup)).toEqual([]);
        if (actual.state === "failed") await command(config, ["/usr/bin/systemctl", "--user", "reset-failed", unit]);
      }
      current?.close();
      await controllerExit;
      await harness.close();
      await rm(root, { recursive: true });
      expect(await lstat(root).then(() => true, () => false)).toBe(false);
      console.info("SUPERVISOR_CLEANED", root);
    },
  };
}
test("real user-systemd cohort stop, full backup, prepared runtime and guarded reopen", async () => {
  await using owned = await fixture();
  let controller = await owned.start();
  const unowned = await connectControl(join(owned.roots.sockets, "roles.sock"));
  const deniedLaunch = await unowned.request("launch", {}).then(() => null, (error: unknown) => error);
  expect(deniedLaunch).toMatchObject({ code: "CONTROL_PROCESS_CHANGED" });
  unowned.close();
  expect(InstallationStateSchema.parse(await owned.control({ method: "status", input: {} })).mode).toBe("open");
  await command(owned.config, ["/usr/bin/systemd-run", "--user", "--quiet", `--unit=${owned.unrelatedUnit}`,
    "--service-type=exec", "/usr/bin/sleep", "infinity"]);
  const unrelated = await inspectUnit(owned.config, owned.unrelatedUnit);
  const unprobed = await controller.request("capabilities", {}).then(() => null, (error: unknown) => error);
  expect(unprobed).toMatchObject({ code: "UPDATES_LAUNCHER_UNAVAILABLE" });
  const executions = z.array(z.object({ identity: z.object({ unit: z.string() }), startedAt: z.string() }))
    .parse(await controller.request("start", {}));
  expect(executions).toHaveLength(2);
  expect(z.object({ freshRestore: z.object({ verified: z.literal(true) }) }).parse(await controller.request("capabilities", {})).freshRestore.verified).toBe(true);
  const running = await inspectUnit(owned.config, owned.config.roles[0]?.unit ?? "");
  expect(running.state).toBe("active");
  const stopped = InstallationStateSchema.parse(await controller.request("stop", { command: owned.update, release: owned.release }));
  expect(stopped.mode).toBe("installing");
  expect(await cgroupPids(running.cgroup)).toEqual([]);
  expect((await inspectUnit(owned.config, owned.unrelatedUnit)).invocationId).toBe(unrelated.invocationId);
  const backup = z.object({ path: z.string(), originalMigrationLedger: z.string() }).parse(await controller.request("backup", {}));
  const ledger = z.array(z.object({ id: z.string(), digest: z.string(), applied_at: z.string() }))
    .parse(JSON.parse(backup.originalMigrationLedger)).sort((a, b) => a.id.localeCompare(b.id));
  expect(ledger).toEqual(z.array(z.object({ id: z.string(), digest: z.string(), applied_at: z.string() })).parse(owned.migrationLedger));
  expect((await lstat(join(backup.path, "manifest.sig"))).isFile()).toBe(true);
  const restoration = z.object({ binding: BindingSchema }).parse(await controller.request("restore", {}));
  expect(restoration.binding.data.generationId).not.toBe(owned.prior.data.generationId);
  if (restoration.binding.data.dialect !== "sqlite" || owned.prior.data.dialect !== "sqlite") throw new Error("Native proof binding");
  const target = new Database(join(restoration.binding.data.dataRoot, "quire.sqlite"), { readonly: true });
  const source = new Database(join(owned.prior.data.dataRoot, "quire.sqlite"), { readonly: true });
  try {
    expect(target.query("SELECT id,name FROM projects ORDER BY id").all()).toEqual(source.query("SELECT id,name FROM projects ORDER BY id").all());
    expect(target.query("SELECT * FROM schema_migrations ORDER BY id").all()).toEqual(source.query("SELECT * FROM schema_migrations ORDER BY id").all());
    expect(target.query("SELECT operation_id FROM o_update_command_keys").all()).toEqual([{ operation_id: owned.update.operationId }]);
  } finally { target.close(); source.close(); }
  await controller.request("prepare", { binding: { ...owned.prior, release: { ...owned.prior.release,
    releaseId: owned.release.id, version: owned.release.version, sequence: owned.release.sequence } } });
  const prepared = await inspectUnit(owned.config, owned.config.roles[0]?.unit ?? "");
  expect(prepared.invocationId).not.toBe(running.invocationId);
  await controller.request("commit", { success: true });
  expect(InstallationStateSchema.parse(await controller.request("state", {})).mode).toBe("open");
  await owned.killController();
  controller = await owned.start();
  const committed = InstallationStateSchema.parse(await controller.request("state", {}));
  expect(committed.floor).toEqual({ sequence: 2, version: "2.0.0" });
  expect(await owned.control({ method: "get", input: { id: owned.update.operationId } })).toMatchObject({ operation: { status: "succeeded" } });
}, 120000);

test("actual preflight and live migration recover into a distinct native generation after controller death", async () => {
  await using owned = await fixture();
  let controller = await owned.start();
  await controller.request("start", {});
  await controller.request("stop", { command: owned.update, release: owned.release });
  await controller.request("backup", {});
  await controller.request("preflight", owned.candidate);
  if (owned.prior.data.dialect !== "sqlite") throw new Error("Native binding required");
  let source = new Database(join(owned.prior.data.dataRoot, "quire.sqlite"), { readonly: true });
  expect(source.query("SELECT name FROM sqlite_master WHERE name='supervisor_migration_probe'").get()).toBeNull();
  source.close();
  await controller.request("migrate", owned.candidate);
  source = new Database(join(owned.prior.data.dataRoot, "quire.sqlite"), { readonly: true });
  expect(source.query("SELECT value FROM supervisor_migration_probe").all()).toEqual([{ value: "migrated" }]);
  source.close();
  await owned.killController();
  controller = await owned.start();
  const state = InstallationStateSchema.parse(await controller.request("state", {}));
  expect(state.mode).toBe("recovery_required");
  await owned.control({ method: "recover", input: { installationId: state.installationId, operationId: owned.update.operationId,
    generation: state.generation, supervisorEpoch: state.supervisorEpoch } });
  const recovered = InstallationStateSchema.parse(await controller.request("state", {}));
  expect(recovered.binding.data.generationId).not.toBe(owned.prior.data.generationId);
  expect(recovered.binding.release).toEqual(owned.prior.release);
  expect(recovered.floor).toEqual({ sequence: 1, version: "1.0.0" });
  if (recovered.binding.data.dialect !== "sqlite") throw new Error("Native restored binding required");
  const restored = new Database(join(recovered.binding.data.dataRoot, "quire.sqlite"), { readonly: true });
  try {
    expect(restored.query("SELECT name FROM sqlite_master WHERE name='supervisor_migration_probe'").get()).toBeNull();
    expect(restored.query("SELECT * FROM schema_migrations ORDER BY id").all()).toEqual([...owned.migrationLedger]);
  } finally { restored.close(); }
}, 120000);

test("killed real maintenance helper retains a missing result through controller death and explicit recovery", async () => {
  await using owned = await fixture();
  let controller = await owned.start();
  await controller.request("start", {});
  await controller.request("stop", { command: owned.update, release: owned.release });
  if (owned.prior.data.dialect !== "sqlite") throw new Error("Native binding required");
  await writeFile(join(owned.prior.data.dataRoot, "pause-helper"), "owned helper boundary", { mode: 0o600 });
  const completion = controller.request("backup", {}).then(() => null, (error: unknown) => error);
  await Promise.race([owned.helperBarrier, completion.then(() => { throw new Error("Helper exited before its subscribed boundary"); })]);
  const helper = await inspectUnit(owned.config, owned.config.helperUnit);
  await command(owned.config, ["/usr/bin/systemctl", "--user", "kill", "--signal=SIGKILL", owned.config.helperUnit]);
  expect(await completion).toBeInstanceOf(Error);
  await command(owned.config, ["/usr/bin/systemctl", "--user", "stop", owned.config.helperUnit]);
  expect(await cgroupPids(helper.cgroup)).toEqual([]);
  await owned.killController();
  controller = await owned.start();
  const state = InstallationStateSchema.parse(await controller.request("state", {}));
  expect(state.mode).toBe("recovery_required");
  await owned.control({ method: "recover", input: { installationId: state.installationId, operationId: owned.update.operationId,
    generation: state.generation, supervisorEpoch: state.supervisorEpoch } });
  const records = z.array(z.object({ identity: z.object({ purpose: z.string() }), exitedAt: z.string().nullable(),
    resultBytes: z.string().nullable() })).parse(await controller.request("executions", {}));
  const interrupted = records.find(record => record.identity.purpose === "backup");
  expect(interrupted?.exitedAt).toBeString();
  expect(interrupted?.resultBytes).toBeNull();
  expect(InstallationStateSchema.parse(await controller.request("state", {})).floor).toEqual({ sequence: 1, version: "1.0.0" });
}, 120000);

test("controller death retains closed recovery and prepared child death prevents commit", async () => {
  await using owned = await fixture();
  let controller = await owned.start();
  await controller.request("start", {});
  await controller.request("stop", { command: owned.update, release: owned.release });
  await controller.request("prepare", {});
  const role = owned.config.roles[0]?.unit ?? "";
  await command(owned.config, ["/usr/bin/systemctl", "--user", "stop", role]);
  const denied = await controller.request("commit", {}).then(() => null, (error: unknown) => error);
  expect(denied).toBeInstanceOf(Error);
  expect(InstallationStateSchema.parse(await controller.request("state", {})).mode).toBe("recovery_required");
  await owned.killController();
  controller = await owned.start();
  const recovered = InstallationStateSchema.parse(await controller.request("state", {}));
  expect(recovered.mode).toBe("recovery_required");
  expect(recovered.operationId).toBe(owned.update.operationId);
  const restartDenied = await controller.request("start", {}).then(() => null, (error: unknown) => error);
  expect(restartDenied).toMatchObject({ code: "CONTROL_LAUNCH_DENIED" });
  expect((await inspectUnit(owned.config, role)).mainPid).toBe(0);
  const stale = await owned.control({ method: "recover", input: { installationId: recovered.installationId,
    operationId: owned.update.operationId, generation: recovered.generation + 1, supervisorEpoch: recovered.supervisorEpoch } })
    .then(() => null, (error: unknown) => error);
  expect(stale).toBeInstanceOf(Error);
  const recovery = await owned.control({ method: "recover", input: { installationId: recovered.installationId,
    operationId: owned.update.operationId, generation: recovered.generation, supervisorEpoch: recovered.supervisorEpoch } });
  expect(recovery).toMatchObject({ status: "failed" });
  expect(InstallationStateSchema.parse(await owned.control({ method: "status", input: {} })).mode).toBe("open");
}, 120000);
