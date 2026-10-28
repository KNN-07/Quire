import { Database } from "bun:sqlite";
import { z } from "zod";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "@quire/runtime";
import { IdSchema, InstantSchema } from "@quire/contracts";
import type { Id, Operation } from "@quire/contracts";
import {
  createUpdateClient, migrations, registerUpdates, reserveUpdateCommand, UpdateError, UpdateService,
} from "../../../services/operations/updates";
import { digest, ReleaseManifest, ReportedUpdateFailure, UpdateConfig } from "../../../services/operations/updates/model";
import type { UpdateOptions } from "../../../services/operations/updates/service";
import type { UpdateTimer } from "../../../services/operations/updates/scheduler";
import { ControlStore } from "../../../services/operations/installation/control-store";
import type { ExecutionIntent } from "../../../services/operations/installation/control-store";
import {
  BindingSchema, InstallationStateSchema, PreparedInstallation, StoppedInstallation,
} from "../../../services/operations/installation/model";
import type {
  ExecutionIdentity, InstallationAuthority, InstallationBinding, InstallationCommit, InstallationStorage,
  MigrationEvidence, ReservedUpdateCommand, VerifiedInstallationBackup,
} from "../../../services/operations/installation/model";
import {
  AuthenticatedControlCommand, canonicalJson, controlDigest, signControlCommand,
} from "../../../services/operations/installation/protocol";
import type { ControlCredential } from "../../../services/operations/installation/protocol";
import { migrations as identityMigrations, register as identity } from "../../../services/accounts/identity";

export const id = (): Id => IdSchema.parse(crypto.randomUUID());
export class ControlledTimer implements UpdateTimer {
  private pending: { readonly instant: string; readonly callback: () => Promise<void> } | null = null;
  private armed: (() => void) | null = null;
  readonly ready = new Promise<void>(resolve => { this.armed = resolve; });
  at(instant: string, callback: () => Promise<void>): () => void {
    const entry = { instant, callback };
    this.pending = entry;
    this.armed?.();
    return () => { if (this.pending === entry) this.pending = null; };
  }
  async advance(now: string): Promise<void> {
    const event = this.pending;
    if (event && event.instant <= now) { this.pending = null; await event.callback(); }
  }
}

// These subclasses model only the published ledger/driver contract. They do not
// observe systemd, cgroups, process fencing, or configured host acceptance.
class LedgerStopped extends StoppedInstallation {
  constructor(state: ReturnType<ControlStore["state"]>, operationId: Id) {
    super(state.installationId, operationId, state.supervisorEpoch, state.generation, []);
  }
}
class LedgerPrepared extends PreparedInstallation {
  constructor(stopped: StoppedInstallation, binding: InstallationBinding, evidence: MigrationEvidence) {
    super(stopped, binding, digest(evidence.resultBytes));
  }
}

export async function fixture(api: "configured" | "unconfigured" = "configured") {
  const root = await mkdtemp(join(tmpdir(), "quire-updates-"));
  let now = InstantSchema.parse("2026-10-27T10:00:00.000Z");
  const clock = { now: () => now };
  const installRoot = join(root, "install");
  await mkdir(join(installRoot, "releases", "prior"), { recursive: true });
  await writeFile(join(installRoot, ".quire-update-root"), "test-install");
  await writeFile(join(installRoot, "releases", "prior", "quire"), "#!/usr/bin/env bun\nconsole.log('1.0.0');\n");
  await chmod(join(installRoot, "releases", "prior", "quire"), 0o700);
  await symlink("releases/prior", join(installRoot, "current"));
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "release-entry.ts")], target: "bun", minify: true });
  if (!bundle.success || !bundle.outputs[0]) throw new UpdateError("FIXTURE_BUILD_FAILED");
  let packageText = JSON.stringify({ format: 1, entrypoint: "bin/quire", files: [
    { path: "bin/quire", data: Buffer.from(`#!/usr/bin/env bun\n${await bundle.outputs[0].text()}`).toString("base64"), executable: true },
  ] });
  const keys = generateKeyPairSync("ed25519");
  let signatureCorrupt = false;
  let feedStatus = 200;
  let feedRequests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/package") return new Response(packageText);
      feedRequests++;
      const payload = Buffer.from(JSON.stringify({ expiresAt: "2026-10-28T00:00:00.000Z", releases: [manifest] }));
      const signature = sign(null, payload, keys.privateKey);
      if (signatureCorrupt) signature[0] = (signature[0] ?? 0) ^ 1;
      return Response.json({ payload: payload.toString("base64"), signature: signature.toString("base64") }, { status: feedStatus });
    },
  });
  let manifest = ReleaseManifest.parse({
    id: crypto.randomUUID(), version: "2.0.0", sequence: 2, security: true, notes: "Fixture",
    expiresAt: "2026-10-28T00:00:00.000Z", compatibleSchema: [6],
    packageUrl: new URL("/package", server.url).href, packageDigest: digest(packageText), packageBytes: Buffer.byteLength(packageText),
  });
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: join(root, "runtime") }), {
    clock, modules: [
      { id: "identity", lane: "A", order: 10, migrations: identityMigrations, register: identity },
      { id: "updates", lane: "O", order: 70, migrations, register: () => {} },
    ],
  });
  const actorId = id();
  await runtime.db.run("INSERT INTO users(id,name,primary_email,operator,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    [actorId, "Operator", "updates@fixture.invalid", now, now]);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const csrf = createHmac("sha256", runtime.secretKey).update(`csrf:${token}`).digest("base64url");
  const sessionId = id();
  await runtime.db.run(`INSERT INTO sessions(id,user_id,token_hash,csrf_hash,created_at,expires_at,last_seen_at,user_agent)
    VALUES(?,?,?,?,?,?,?,'update fixture')`, [sessionId, actorId, digest(token), digest(csrf), now, "2026-10-28T00:00:00.000Z", now]);
  const context = { ...runtime, routes: runtime.routes.forLane("O") };
  const dataRoot = join(root, "data", "prior");
  await mkdir(dataRoot, { recursive: true });
  let app = new Database(join(dataRoot, "application.sqlite"));
  app.exec("CREATE TABLE documents (body TEXT NOT NULL); INSERT INTO documents VALUES('retained source');");
  const prior = BindingSchema.parse({
    release: {
      target: join(installRoot, "releases", "prior"), entrypoint: "quire", releaseId: id(),
      sequence: 1, version: "1.0.0", manifestDigest: digest("prior"), packageDigest: digest("prior package"),
    }, data: { dialect: "sqlite", generationId: id(), dataRoot },
  });
  const roleInventory = [{ role: "api", unit: "quire-fixture-api.service", activators: [] }];
  const controlPath = join(root, "control.sqlite");
  let control = ControlStore.provision(controlPath, InstallationStateSchema.parse({
    installationId: "test-install", protocolVersion: 1, generation: 0, roleInventory,
    roleInventoryDigest: controlDigest(canonicalJson(roleInventory)), supervisorEpoch: id(),
    mode: "open", operationId: null, binding: prior, floor: { sequence: 1, version: "1.0.0" },
  }));
  let failMigration = false;
  let failHealthcheck = false;
  let failRollback = false;
  let failBackup = false;
  let failPreflight = false;
  let interruptMigration = false;
  let backupBarrier: { readonly reached: () => void; readonly resume: Promise<void> } | null = null;
  const migrationSql = "CREATE TABLE migrated(version TEXT); INSERT INTO migrated VALUES('2.0.0');";

  async function execute<T>(purpose: ExecutionIdentity["purpose"], work: () => Promise<T>): Promise<{ readonly value: T; readonly evidence: MigrationEvidence }> {
    const state = control.state();
    const execution: ExecutionIdentity = {
      id: id(), installationId: state.installationId, operationId: state.operationId,
      supervisorEpoch: state.supervisorEpoch, generation: state.generation,
      role: "contract-fixture-only", purpose, unit: `fixture-${purpose}.service`,
      invocationId: crypto.randomUUID(), containerIds: [],
    };
    control.executionIntent(execution, now);
    control.acknowledgeExecution(execution.id, "started", now);
    try {
      const value = await work();
      const resultBytes = canonicalJson({ outcome: "succeeded", scope: "ledger-contract-fixture-only" });
      control.acknowledgeExecution(execution.id, "exited", now, resultBytes);
      return { value, evidence: { execution, resultBytes, migrationDigests: [digest(migrationSql)] } };
    } catch (error) {
      const code = error instanceof UpdateError ? error.code : "UPDATE_FAILED";
      const resultBytes = canonicalJson({ outcome: "failed", code, detail: error instanceof Error ? error.message : String(error),
        scope: "ledger-contract-fixture-only" });
      control.acknowledgeExecution(execution.id, "exited", now, resultBytes);
      throw new ReportedUpdateFailure(code, { execution, resultBytes, migrationDigests: [digest(migrationSql)] });
    }
  }
  function assertStopped(stopped: StoppedInstallation): void {
    const state = control.state();
    if (state.mode !== "installing" || state.operationId !== stopped.operationId ||
        state.generation !== stopped.generation || state.supervisorEpoch !== stopped.supervisorEpoch ||
        state.installationId !== stopped.installationId || control.executions().some(row => row.exitedAt === null)) {
      throw new UpdateError("FIXTURE_STOPPED_CONTRACT_INVALID");
    }
  }
  const storage: InstallationStorage = {
    async backup(stopped) {
      assertStopped(stopped);
      const executed = await execute("backup", async () => {
        if (failBackup) throw new UpdateError("BACKUP_UNAVAILABLE");
        const backupId = id();
        const path = join(root, `backup-${backupId}.sqlite`);
        await writeFile(path, app.serialize(), { flag: "wx" });
        using verification = new Database(path, { readonly: true });
        if (z.object({ integrity_check: z.string() }).parse(verification.query("PRAGMA integrity_check").get()).integrity_check !== "ok") {
          throw new UpdateError("BACKUP_INVALID");
        }
        return {
          id: backupId, path, digest: digest(await readFile(path)), verifiedAt: now,
          originalMigrationLedger: JSON.stringify(await runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")),
        };
      });
      if (backupBarrier !== null) { backupBarrier.reached(); await backupBarrier.resume; }
      return executed.value;
    },
    async preflight(input) {
      assertStopped(input.stopped);
      return (await execute("preflight", async () => {
        const path = join(root, `preflight-${crypto.randomUUID()}.sqlite`);
        await copyFile(input.backup.path, path);
        using copy = new Database(path);
        copy.exec(failPreflight ? "INVALID SQL" : migrationSql);
      })).evidence;
    },
    async migrate(input) {
      assertStopped(input.stopped);
      if (interruptMigration) throw new UpdateError("HELPER_INTERRUPTED");
      return (await execute("migration", () => {
        app.exec(migrationSql);
        if (failMigration) throw new UpdateError("MIGRATION_FAILED");
        return Promise.resolve();
      })).evidence;
    },
    async restore(input) {
      assertStopped(input.stopped);
      const executed = await execute("restore", async () => {
        if (failRollback) throw new UpdateError("ROLLBACK_FAILED");
        if (digest(await readFile(input.backup.path)) !== input.backup.digest) throw new UpdateError("BACKUP_INVALID");
        const generationId = id();
        const fresh = join(root, "data", generationId);
        await mkdir(fresh);
        await copyFile(input.backup.path, join(fresh, "application.sqlite"));
        const restored = new Database(join(fresh, "application.sqlite"), { create: false });
        app.close();
        app = restored;
        return BindingSchema.parse({ ...input.prior, data: { dialect: "sqlite", generationId, dataRoot: fresh } });
      });
      return { binding: executed.value, evidence: executed.evidence };
    },
  };
  function observeStopped(operationId: Id): StoppedInstallation {
    const state = control.state();
    control.recordStopped(operationId, {
      observedAt: now, inventoryDigest: state.roleInventoryDigest,
      managerEvidenceBytes: '{"scope":"ledger-contract-fixture-only","notHostAttestation":true}',
      executions: control.executions().map(row => row.identity),
    }, now);
    return new LedgerStopped(state, operationId);
  }
  async function prepare(stoppedAuthority: StoppedInstallation, binding: InstallationBinding) {
    assertStopped(stoppedAuthority);
    const executed = await execute("health", async () => {
      const child = Bun.spawn([process.execPath, join(binding.release.target, binding.release.entrypoint)], { stdout: "pipe", stderr: "pipe" });
      const [exit, output, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (exit !== 0 || output.trim() !== binding.release.version ||
          (failHealthcheck && binding.release.version === "2.0.0")) throw new UpdateError("HEALTHCHECK_FAILED", stderr);
    });
    return new LedgerPrepared(stoppedAuthority, binding, executed.evidence);
  }
  function commit(input: InstallationCommit): Promise<Operation> {
    const state = control.state();
    const health = control.intents(input.operation.id).find(intent => intent.kind === "health" &&
      intent.generation === state.generation && intent.supervisorEpoch === state.supervisorEpoch &&
      intent.outcome === "succeeded" && intent.inputBytes === canonicalJson(input.prepared.binding));
    if (health === undefined) throw new UpdateError("FIXTURE_HEALTH_RESULT_MISSING");
    return Promise.resolve(control.commit({
      operationId: input.operation.id, supervisorEpoch: state.supervisorEpoch, generation: state.generation,
      binding: input.prepared.binding, healthIntentId: health.id,
      outcome: input.operation.errorCode === null ? "succeeded" : "failed", errorCode: input.operation.errorCode,
      resultBytes: input.resultBytes, successfulFloor: input.successfulFloor, at: now,
    }));
  }
  async function recoverStep<T>(
    operationId: Id, kind: ExecutionIntent["kind"], input: unknown, work: () => Promise<T>,
    resultValue: (result: T) => unknown = result => result,
  ): Promise<T> {
    const state = control.state();
    const intentId = id();
    control.recordIntent({ id: intentId, operationId, kind, inputBytes: canonicalJson(input),
      supervisorEpoch: state.supervisorEpoch, generation: state.generation, createdAt: now });
    const result = await work();
    control.recordResult(intentId, "succeeded", canonicalJson(resultValue(result)), now);
    return result;
  }
  const authority: InstallationAuthority = {
    capabilities: () => Promise.resolve({
      driver: "systemd-local-v1", installationId: "test-install", roleInventoryDigest: control.state().roleInventoryDigest,
      dialect: "sqlite", freshRestore: { inventoryDigest: digest("ledger-contract-fixture-only"), verified: true },
    }),
    stopForUpdate: operationId => Promise.resolve(observeStopped(operationId)),
    async withStopped(stoppedAuthority, work) { assertStopped(stoppedAuthority); return work(); },
    prepare: input => prepare(input.stopped, input.binding),
    commit,
    async recover(input) {
      const receipt = control.receipt(input.operationId);
      if (receipt?.recovery === null || receipt?.recovery === undefined) throw new UpdateError("FIXTURE_RECOVERY_MISSING");
      const stoppedAuthority = observeStopped(input.operationId);
      let binding = receipt.recovery.prior;
      let restoreResult = receipt.recovery.restoreResult;
      if (receipt.recovery.migrationIntent !== null) {
        const backup = receipt.recovery.backup;
        const ledger = receipt.recovery.originalMigrationLedger;
        if (backup === null || ledger === null) throw new UpdateError("FIXTURE_BACKUP_MISSING");
        const verified: VerifiedInstallationBackup = { ...backup, originalMigrationLedger: ledger };
        const restored = await recoverStep(input.operationId, "restore", { backup, binding }, () => storage.restore({
          stopped: stoppedAuthority, backup: verified, prior: binding, retained: [binding],
        }));
        binding = restored.binding;
        restoreResult = canonicalJson(restored);
      }
      control.recovery(input.operationId, {
        candidate: receipt.recovery.candidate, backup: receipt.recovery.backup,
        originalMigrationLedger: receipt.recovery.originalMigrationLedger, restoreResult,
      }, now);
      const priorTarget = binding.release.target.slice(installRoot.length + 1);
      await recoverStep(input.operationId, "activation", binding, async () => {
        await service.installer.activate(priorTarget);
        return { target: priorTarget };
      });
      const prepared = await recoverStep(input.operationId, "health", binding, () => prepare(stoppedAuthority, binding),
        value => ({ binding: value.binding, healthEvidenceDigest: value.healthEvidenceDigest }));
      const result = { recovered: true, prior: binding.release.target };
      return commit({
        prepared, operation: { ...receipt.operation, status: "failed", progress: 1, result, errorCode: "INTERRUPTED_UPDATE" },
        resultBytes: canonicalJson(result), successfulFloor: null,
      });
    },
  };
  const config = UpdateConfig.parse({
    feedUrl: new URL("/feed", server.url).href, trustKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }),
    installRoot, installId: "test-install", currentVersion: "1.0.0", currentSequence: 1, schemaVersion: 6,
    window: { start: now, end: "2026-10-27T11:00:00.000Z" }, allowLoopbackHttp: true,
  });
  const options = (): UpdateOptions => ({
    config, control, authority, storage, clock,
    async authorizeActor(actor) {
      const row = z.object({ operator: z.number(), deleted_at: z.string().nullable() }).nullable().parse(
        await runtime.db.get("SELECT operator,deleted_at FROM users WHERE id=?", [actor]),
      );
      if (row === null || row.operator !== 1 || row.deleted_at !== null) throw new UpdateError("FORBIDDEN");
    },
  });
  let service = new UpdateService(options());
  const credential: ControlCredential = { id: id(), installationId: "test-install", channel: "api", secret: crypto.getRandomValues(new Uint8Array(32)) };
  const client = createUpdateClient(credential, clock, {
    async send(envelope) {
      const authenticated = AuthenticatedControlCommand.authenticate(envelope, credential, now);
      const command = authenticated.envelope.command;
      if (command.method === "submit") return service.create(command.input);
      if (command.method === "get") return service.get(command.input.id);
      if (command.method === "list") return service.list(command.input);
      if (command.method === "releases") return service.releases();
      throw new UpdateError("CONTROL_FORBIDDEN");
    },
  });
  registerUpdates(context, api === "configured" ? { installationId: config.installId, client } : undefined);
  async function reserve(extra: { readonly at?: string; readonly autoSecurity?: boolean; readonly key?: string } = {}): Promise<ReservedUpdateCommand> {
    return reserveUpdateCommand(runtime.uow, config.installId, actorId, extra.key ?? crypto.randomUUID(),
      { releaseId: manifest.id, at: InstantSchema.parse(extra.at ?? now), autoSecurity: extra.autoSecurity ?? false });
  }
  function recoveryCommand(operationId: Id) {
    const state = control.state();
    const operator: ControlCredential = { ...credential, channel: "operator" };
    return AuthenticatedControlCommand.authenticate(signControlCommand({
      protocolVersion: 1, installationId: config.installId, credentialId: operator.id, requestId: id(), issuedAt: now,
      command: { method: "recover", input: { installationId: config.installId, operationId,
        supervisorEpoch: state.supervisorEpoch, generation: state.generation } },
    }, operator), operator, now);
  }
  return {
    root, runtime, config, actorId, context, clock, sessionId, controlPath, authority, storage, client, credential, reserve, recoveryCommand,
    get service() { return service; }, get control() { return control; }, get options() { return options(); },
    async reopenControl() {
      await service.close();
      control.close();
      control = ControlStore.open(controlPath, config.installId, id(), now);
      service = new UpdateService(options());
    },
    headers: { cookie: `quire_session=${token}`, origin: new URL(runtime.config.publicUrl).origin, "x-csrf-token": csrf,
      "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    advance: (time: string) => { now = InstantSchema.parse(time); },
    schedule: async (extra: { readonly at?: string; readonly autoSecurity?: boolean; readonly key?: string } = {}) => service.create(await reserve(extra)),
    alterManifest: (change: Partial<z.input<typeof ReleaseManifest>>) => { manifest = ReleaseManifest.parse({ ...manifest, ...change }); },
    corruptSignature: () => { signatureCorrupt = true; },
    corruptPackage: () => { packageText = packageText.replace('"format":1', '"format":2'); },
    unsafePackage: () => {
      packageText = packageText.replace('"path":"bin/quire"', '"path":"../escape"');
      manifest = ReleaseManifest.parse({ ...manifest, packageDigest: digest(packageText), packageBytes: Buffer.byteLength(packageText) });
    },
    rejectFeed: () => { feedStatus = 503; }, feedRequests: () => feedRequests,
    failMigration: () => { failMigration = true; }, failHealthcheck: () => { failHealthcheck = true; },
    failRollback: (value: boolean) => { failRollback = value; }, failBackup: () => { failBackup = true; },
    failPreflight: () => { failPreflight = true; }, interruptMigration: () => { interruptMigration = true; },
    pauseBackup() {
      let reached = () => {};
      let resume = () => {};
      const ready = new Promise<void>(resolve => { reached = resolve; });
      const barrier = new Promise<void>(resolve => { resume = resolve; });
      backupBarrier = { reached, resume: barrier };
      return { ready, resume };
    },
    isHeld: () => control.state().mode !== "open",
    document: () => app.query("SELECT body FROM documents").get(),
    migrated: () => app.query("SELECT name FROM sqlite_master WHERE name='migrated'").get(),
    [Symbol.asyncDispose]: async () => {
      await service.close(); control.close(); await server.stop(true); app.close(); await runtime.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
