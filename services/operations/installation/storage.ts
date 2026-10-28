import { lstat, open, readFile, readdir, rename, symlink, unlink } from "node:fs/promises";
import { createPrivateKey } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { DigestSchema, IdSchema, InstantSchema, OperationSchema } from "@quire/contracts";
import type { Digest, Operation } from "@quire/contracts";
import { BindingSchema, ControlError } from "./model";
import type {
  InstallationBinding, InstallationMigration, InstallationPreflight, InstallationRestore, InstallationStorage,
  MigrationEvidence, RestoredBinding, StoppedInstallation, VerifiedInstallationBackup,
} from "./model";
import { canonicalJson, controlDigest } from "./protocol";
import { checkStorageBinding, openMaintenanceBinding, StoragePolicySchema } from "./prepared-storage-host";
import type { StoragePolicy } from "./prepared-storage-host";
import { inspectRestoreTarget } from "../backups/restore-target";
import type { RestoreTargetIdentity } from "../backups/restore-target";
import type { SystemdInstallationAuthority } from "./systemd-authority";
import { below, privateDirectory } from "./driver-config";
import { assertFreshRuntimeRoot } from "./role-mounts";

const backupSchema = z.strictObject({
  id: IdSchema, digest: DigestSchema, path: z.string().startsWith("/"), verifiedAt: InstantSchema,
  originalMigrationLedger: z.string(),
});
const readiness = z.object({ migrations: z.array(z.object({ digest: DigestSchema })) });
function distinct(target: RestoreTargetIdentity, retained: RestoreTargetIdentity): void {
  if (canonicalJson(target.database) === canonicalJson(retained.database) ||
      (target.database.kind === "postgres" && retained.database.kind === "postgres" &&
        target.database.cluster === retained.database.cluster && target.database.database === retained.database.database)) {
    throw new ControlError("UPDATES_RESTORE_NOT_FRESH");
  }
  const left = [target.repositories, ...(target.database.kind === "sqlite" ? [target.database] : []),
    ...(target.blobs.kind === "disk" ? [target.blobs] : [])];
  const right = [retained.repositories, ...(retained.database.kind === "sqlite" ? [retained.database] : []),
    ...(retained.blobs.kind === "disk" ? [retained.blobs] : [])];
  for (const a of left) for (const b of right) {
    if (a.host === b.host && (a.device === b.device && a.inode === b.inode || below(a.path, b.path) || below(b.path, a.path))) {
      throw new ControlError("UPDATES_RESTORE_NOT_FRESH");
    }
  }
  if (target.blobs.kind === "s3" && retained.blobs.kind === "s3" &&
      (target.blobs.endpoint !== retained.blobs.endpoint || target.blobs.bucket === retained.blobs.bucket)) {
    throw new ControlError("UPDATES_RESTORE_NOT_FRESH");
  }
}
export class InstallationStorageHost implements InstallationStorage {
  readonly policy: StoragePolicy;
  private proof: { inventoryDigest: Digest; verified: true } | undefined;
  constructor(readonly authority: SystemdInstallationAuthority, input: unknown) {
    this.policy = StoragePolicySchema.parse(input);
    authority.bindStorage(this);
  }
  private retained(): readonly InstallationBinding[] {
    const bindings = new Map<string, InstallationBinding>();
    const add = (binding: InstallationBinding) => bindings.set(controlDigest(canonicalJson(binding)), binding);
    for (const binding of this.policy.retained) add(binding);
    for (const name of readdirSync(this.authority.config.controlRoot)) {
      if (!/^target-[0-9a-f-]{36}\.json$/.test(name)) continue;
      const value: unknown = JSON.parse(readFileSync(join(this.authority.config.controlRoot, name), "utf8"));
      add(z.object({ binding: BindingSchema }).parse(value).binding);
    }
    add(this.authority.store.state().binding);
    let cursor: z.infer<typeof IdSchema> | undefined;
    for (;;) {
      const page = this.authority.store.list({ limit: 100, ...(cursor ? { cursor } : {}) });
      for (const row of page) {
        const recovery = this.authority.store.receipt(row.operation.id)?.recovery;
        if (recovery) {
          add(recovery.prior);
          if (recovery.candidate) add(recovery.candidate);
          if (recovery.restoreResult) {
            const value: unknown = JSON.parse(recovery.restoreResult);
            const restored = z.object({ binding: BindingSchema }).safeParse(value);
            if (restored.success) add(restored.data.binding);
          }
        }
      }
      if (page.length < 100) break;
      cursor = page.at(-1)?.operation.id;
    }
    return [...bindings.values()];
  }
  private commands() {
    const values = [];
    let cursor: z.infer<typeof IdSchema> | undefined;
    for (;;) {
      const page = this.authority.store.list({ limit: 100, ...(cursor ? { cursor } : {}) });
      for (const row of page) {
        const receipt = this.authority.store.receipt(row.operation.id);
        if (receipt) values.push(receipt.command);
      }
      if (page.length < 100) return values;
      cursor = page.at(-1)?.operation.id;
    }
  }
  async capabilities(): Promise<{ readonly inventoryDigest: Digest; readonly verified: true }> {
    this.authority.status();
    const retained = this.retained();
    const available = this.policy.freshTargets.filter(target =>
      !retained.some(binding => binding.data.generationId === target.data.generationId));
    if (available.length < 2) throw new ControlError("UPDATES_RESTORE_UNAVAILABLE", "Preflight and rollback need two unclaimed fresh targets");
    if (this.proof) return this.proof;
    if (!this.authority.config.maintenanceSecrets.includes(this.policy.signerPath) ||
        createPrivateKey(await readFile(this.policy.signerPath)).asymmetricKeyType !== "ed25519") {
      throw new ControlError("UPDATES_RESTORE_UNAVAILABLE", "Independent Ed25519 archive signer is not configured");
    }
    for (const root of [this.policy.archiveRoot, this.policy.restoreRoot]) {
      await privateDirectory(root);
      const probePath = join(root, `.quire-probe-${crypto.randomUUID()}`);
      const probe = await open(probePath, "wx", 0o600);
      try { await probe.writeFile("owned-capability-probe\n"); await probe.sync(); }
      finally { await probe.close(); await unlink(probePath); }
    }
    const inspected: RestoreTargetIdentity[] = [];
    const authorities = new Set<Digest>();
    for (const binding of retained) {
      const opened = await openMaintenanceBinding(binding, this.authority.store.state().mode === "open");
      try {
        inspected.push(await inspectRestoreTarget(opened.context));
        authorities.add(controlDigest(opened.context.secretKey));
      } finally { await opened.close(); }
    }
    const targets: RestoreTargetIdentity[] = [];
    for (const [index, binding] of available.entries()) {
      await assertFreshRuntimeRoot(this.authority.config, binding, [...retained, ...available.slice(0, index)]);
      if (binding.data.dialect !== this.authority.store.state().binding.data.dialect ||
          retained.some(prior => prior.data.generationId === binding.data.generationId)) throw new ControlError("UPDATES_RESTORE_NOT_FRESH");
      const result = await checkStorageBinding(binding);
      if (authorities.size !== 1 || !authorities.has(result.authority)) throw new ControlError("UPDATES_RESTORE_SECRET_MISMATCH");
      const data = binding.data;
      if (data.dialect === "postgres" && retained.some(prior => prior.data.dialect === "postgres" &&
          prior.data.redis.namespace === data.redis.namespace)) throw new ControlError("UPDATES_RESTORE_NOT_FRESH");
      if (!result.identity.blobs.empty || !result.identity.repositories.empty) throw new ControlError("UPDATES_RESTORE_NOT_EMPTY");
      for (const identity of [...inspected, ...targets]) distinct(result.identity, identity);
      targets.push(result.identity);
    }
    const inventoryDigest = controlDigest(canonicalJson({ policy: this.policy, retained: inspected, targets }));
    const path = join(this.authority.config.controlRoot, `storage-probe-${inventoryDigest}.json`);
    try {
      const file = await open(path, "wx", 0o600);
      try { await file.writeFile(canonicalJson({ inventoryDigest, retained: inspected, targets })); await file.sync(); }
      finally { await file.close(); }
    } catch (error) {
      if (!z.object({ code: z.literal("EEXIST") }).safeParse(error).success) throw error;
      const saved: unknown = JSON.parse(await readFile(path, "utf8"));
      if (z.object({ inventoryDigest: DigestSchema }).parse(saved).inventoryDigest !== inventoryDigest) throw new ControlError("CONTROL_STORAGE_PROBE_CHANGED");
    }
    this.proof = { inventoryDigest, verified: true };
    return this.proof;
  }
  async checkBinding(stopped: StoppedInstallation, binding: InstallationBinding): Promise<void> {
    await this.authority.assertStopped(stopped);
    await this.authority.runMaintenance(stopped, "health", binding, { action: "check" });
  }
  async backup(stopped: StoppedInstallation): Promise<VerifiedInstallationBackup> {
    const result = await this.authority.runMaintenance(stopped, "backup", this.authority.store.state().binding,
      { action: "backup", policy: this.policy });
    return backupSchema.parse(result.result);
  }
  private async target(stopped: StoppedInstallation, prior: InstallationBinding): Promise<InstallationBinding> {
    const retained = this.retained();
    const claims = await readdir(this.authority.config.controlRoot);
    const target = this.policy.freshTargets.find(binding =>
      binding.data.dialect === prior.data.dialect && canonicalJson(binding.release) === canonicalJson(prior.release) &&
      !retained.some(item => item.data.generationId === binding.data.generationId) &&
      !claims.includes(`target-${binding.data.generationId}.json`));
    if (!target) throw new ControlError("UPDATES_RESTORE_UNAVAILABLE", "No unclaimed provisioned original-dialect target");
    await this.authority.assertStopped(stopped);
    await assertFreshRuntimeRoot(this.authority.config, target, retained);
    const file = await open(join(this.authority.config.controlRoot, `target-${target.data.generationId}.json`), "wx", 0o600);
    try { await file.writeFile(canonicalJson({ operationId: stopped.operationId, binding: target })); await file.sync(); }
    finally { await file.close(); }
    const directory = await open(this.authority.config.controlRoot, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return target;
  }
  async restore(input: InstallationRestore): Promise<RestoredBinding> {
    const retained = this.retained();
    const target = await this.target(input.stopped, input.prior);
    for (const supplied of input.retained) {
      if (!retained.some(binding => canonicalJson(binding) === canonicalJson(supplied))) {
        throw new ControlError("CONTROL_RETAINED_INVENTORY_MISMATCH");
      }
    }
    const result = await this.authority.runMaintenance(input.stopped, "restore", input.prior, {
      action: "restore", policy: this.policy, archive: input.backup.path, target, retained, commands: this.commands(),
    });
    const parsed = z.object({ binding: BindingSchema, readiness,
      receipt: z.object({ backupId: IdSchema, manifestDigest: DigestSchema }) }).parse(result.result);
    if (parsed.receipt.backupId !== input.backup.id || parsed.receipt.manifestDigest !== input.backup.digest) {
      throw new ControlError("CONTROL_BACKUP_IDENTITY_MISMATCH");
    }
    return { binding: parsed.binding, evidence: { execution: result.execution,
      resultBytes: result.resultBytes, migrationDigests: parsed.readiness.migrations.map(row => row.digest) } };
  }
  async preflight(input: InstallationPreflight): Promise<MigrationEvidence> {
    const prior = this.authority.store.receipt(input.stopped.operationId)?.recovery?.prior;
    if (!prior) throw new ControlError("CONTROL_RECOVERY_MISSING");
    const restored = await this.restore({ stopped: input.stopped, prior, backup: input.backup, retained: this.retained() });
    const candidate = { ...input.candidate, data: restored.binding.data };
    const result = await this.authority.runMaintenance(input.stopped, "preflight", candidate, {
      action: "preflight", roles: [...new Set(this.authority.config.roles.map(role => role.role))],
    });
    const evidence = { execution: result.execution, resultBytes: result.resultBytes,
      migrationDigests: readiness.parse(result.result).migrations.map(row => row.digest) };
    await this.authority.runMaintenance(input.stopped, "preflight", candidate, { action: "check" });
    return evidence;
  }
  async migrate(input: InstallationMigration): Promise<MigrationEvidence> {
    const receipt = this.authority.store.receipt(input.stopped.operationId);
    if (receipt?.recovery?.originalMigrationLedger !== input.originalMigrationLedger) throw new ControlError("CONTROL_MIGRATION_LEDGER_MISMATCH");
    const result = await this.authority.runMaintenance(input.stopped, "migration", input.candidate, { action: "migrate" });
    return { execution: result.execution, resultBytes: result.resultBytes,
      migrationDigests: readiness.parse(result.result).migrations.map(row => row.digest) };
  }
  async recover(stopped: StoppedInstallation): Promise<Operation> {
    const receipt = this.authority.store.receipt(stopped.operationId);
    if (!receipt?.recovery) throw new ControlError("CONTROL_RECOVERY_MISSING");
    let binding = receipt.recovery.prior;
    let digests: readonly Digest[] = [];
    if (receipt.recovery.migrationIntent !== null) {
      const backup = backupSchema.parse({ ...receipt.recovery.backup, originalMigrationLedger: receipt.recovery.originalMigrationLedger });
      const restored = await this.restore({ stopped, backup, prior: binding, retained: this.retained() });
      binding = restored.binding;
      digests = restored.evidence.migrationDigests;
      this.authority.store.recovery(stopped.operationId, {
        candidate: receipt.recovery.candidate, backup: receipt.recovery.backup,
        originalMigrationLedger: receipt.recovery.originalMigrationLedger, restoreResult: canonicalJson(restored),
      }, InstantSchema.parse(new Date().toISOString()));
    }
    await this.checkBinding(stopped, binding);
    const activationId = IdSchema.parse(crypto.randomUUID());
    this.authority.store.recordIntent({ id: activationId, operationId: stopped.operationId,
      supervisorEpoch: stopped.supervisorEpoch, generation: stopped.generation, kind: "activation",
      inputBytes: canonicalJson(binding), createdAt: InstantSchema.parse(new Date().toISOString()) });
    const pointer = join(this.authority.config.applicationRoot, "current");
    if (!(await lstat(pointer)).isSymbolicLink() || !below(this.authority.config.applicationRoot, binding.release.target)) {
      throw new ControlError("CONTROL_RELEASE_POINTER_INVALID");
    }
    const temporary = join(this.authority.config.applicationRoot, `.recovery-${stopped.operationId}-${stopped.generation}`);
    await symlink(relative(this.authority.config.applicationRoot, binding.release.target), temporary);
    await rename(temporary, pointer);
    const directory = await open(this.authority.config.applicationRoot, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    this.authority.store.recordResult(activationId, "succeeded", canonicalJson({ target: binding.release.target }),
      InstantSchema.parse(new Date().toISOString()));
    const prepared = await this.authority.prepare({ stopped, binding, expectedMigrationDigests: digests });
    const result = { recovered: true, rolledBack: receipt.recovery.migrationIntent !== null };
    return this.authority.commit({ prepared, operation: OperationSchema.parse({ ...receipt.operation, status: "failed", progress: 1,
      errorCode: receipt.operation.errorCode ?? "UPDATE_INTERRUPTED", result }),
    resultBytes: canonicalJson(result), successfulFloor: null });
  }
}
