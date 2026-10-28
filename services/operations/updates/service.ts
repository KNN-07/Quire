import { z } from "zod";
import { join, relative } from "node:path";
import { DigestSchema, IdSchema, InstantSchema, OperationSchema } from "@quire/contracts";
import type { Clock, Id, Operation, Release } from "@quire/contracts";
import type { ControlStore, ExecutionIntent } from "../installation/control-store";
import {
  BindingSchema, ExecutionIdentitySchema, ReservedUpdateCommandSchema,
} from "../installation/model";
import type {
  ControlReceipt, InstallationAuthority, InstallationBinding, InstallationStorage,
  MigrationEvidence, ReservedUpdateCommand, StoppedInstallation, UpdateClient,
  UpdateOperationQuery, VerifiedInstallationBackup,
} from "../installation/model";
import { canonicalJson, controlDigest } from "../installation/protocol";
import type { AuthenticatedControlCommand } from "../installation/protocol";
import { discover, fetchPackage } from "./feed";
import { OwnedInstaller } from "./installer";
import { ReportedUpdateFailure, UpdateConfig, UpdateError, assertWindow, newerVersion } from "./model";
import type { SignedRelease } from "./model";
import { UpdateStore } from "./store";

const Evidence = z.strictObject({
  execution: ExecutionIdentitySchema, migrationDigests: z.array(DigestSchema).readonly(), resultBytes: z.string().min(1),
});
const VerifiedBackup = z.strictObject({
  id: IdSchema, digest: DigestSchema, path: z.string().startsWith("/"), verifiedAt: InstantSchema,
  originalMigrationLedger: z.string(),
});
export interface UpdateOptions {
  readonly config: UpdateConfig;
  readonly control: ControlStore;
  readonly authority: InstallationAuthority;
  readonly storage: InstallationStorage;
  readonly clock: Clock;
  /** Rechecks the live application's active operator immediately before stop. */
  readonly authorizeActor: (actorId: Id) => Promise<void>;
}

/** Stable, independently supervised controller only; API modules use UpdateClient. */
export class UpdateService implements UpdateClient {
  readonly config: UpdateConfig;
  readonly store: UpdateStore;
  readonly installer: OwnedInstaller;
  private active: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private closed = false;
  constructor(readonly options: UpdateOptions) {
    this.config = UpdateConfig.parse(options.config);
    if (Date.parse(this.config.window.end) <= Date.parse(this.config.window.start)) throw new UpdateError("INVALID_WINDOW");
    if (options.control.state().installationId !== this.config.installId) throw new UpdateError("INSTALLATION_MISMATCH");
    this.store = new UpdateStore(options.control, options.clock);
    this.installer = new OwnedInstaller(this.config);
  }
  private async capabilities(): Promise<void> {
    const capability = await this.options.authority.capabilities();
    const state = this.options.control.state();
    if (capability.driver !== "systemd-local-v1") throw new UpdateError("UPDATES_DEPLOYMENT_UNSUPPORTED");
    if (capability.installationId !== state.installationId || capability.roleInventoryDigest !== state.roleInventoryDigest ||
        capability.dialect !== state.binding.data.dialect) throw new UpdateError("UPDATES_AUTHORITY_UNAVAILABLE");
    if (!capability.freshRestore.verified) throw new UpdateError("UPDATES_RESTORE_UNAVAILABLE");
  }
  async releases(): Promise<readonly Release[]> {
    const releases = await discover(this.config, this.options.clock.now());
    const schedules = new Map<Id, z.infer<typeof InstantSchema>>();
    let cursor: Id | undefined;
    for (;;) {
      const rows = this.options.control.list({ status: "queued", limit: 100, ...(cursor === undefined ? {} : { cursor }) });
      for (const row of rows) {
        const receipt = this.options.control.receipt(row.operation.id);
        if (receipt === null) throw new UpdateError("UPDATE_NOT_FOUND");
        schedules.set(receipt.release.id, receipt.command.request.at);
      }
      if (rows.length < 100) break;
      cursor = rows.at(-1)?.operation.id;
    }
    return releases.map(release => ({
      id: release.id, version: release.version, manifestDigest: release.manifestDigest, notes: release.notes,
      signatureVerified: true, compatibleSchema: release.compatibleSchema, scheduledAt: schedules.get(release.id) ?? null,
    }));
  }
  get(id: Id) { return Promise.resolve(this.options.control.get(id)); }
  list(query: UpdateOperationQuery) { return Promise.resolve(this.options.control.list(query)); }
  private eligible(release: SignedRelease, securityOnly: boolean): void {
    const current = this.store.floor();
    if (release.sequence <= current.sequence || !newerVersion(release.version, current.version)) throw new UpdateError("REPLAY_OR_DOWNGRADE");
    if (!release.compatibleSchema.includes(this.config.schemaVersion)) throw new UpdateError("INCOMPATIBLE_SCHEMA");
    if (securityOnly && !release.security) throw new UpdateError("SECURITY_RELEASE_REQUIRED");
    if (Date.parse(release.expiresAt) <= Date.parse(this.options.clock.now())) throw new UpdateError("RELEASE_EXPIRED");
  }
  async create(input: ReservedUpdateCommand): Promise<Operation> {
    if (this.closed) throw new UpdateError("UPDATES_CLOSED");
    const request = ReservedUpdateCommandSchema.parse(input);
    const prior = this.store.existing(request);
    if (prior !== null) return prior;
    await this.capabilities();
    assertWindow(this.config, request.request.at);
    if (Date.parse(request.request.at) < Date.parse(this.options.clock.now())) throw new UpdateError("SCHEDULE_IN_PAST");
    const releases = await discover(this.config, this.options.clock.now());
    const release = releases.find(candidate => candidate.id === request.request.releaseId);
    if (!release) throw new UpdateError("RELEASE_NOT_FOUND");
    this.eligible(release, request.request.autoSecurity);
    await this.installer.validate();
    const operation = this.store.enqueue(request, release);
    for (const listener of this.listeners) listener();
    return operation;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  nextAt(): Promise<string | null> { return Promise.resolve(this.options.control.nextAt()); }
  tick(): Promise<void> {
    if (this.closed) return Promise.reject(new UpdateError("UPDATES_CLOSED"));
    if (this.active) return this.active;
    this.active = this.runDue().finally(() => { this.active = null; });
    return this.active;
  }
  private async runDue(): Promise<void> {
    const job = this.store.due();
    if (job !== null) await this.install(job);
  }
  private intent(id: Id, kind: ExecutionIntent["kind"], input: unknown): Id {
    const state = this.options.control.state();
    const intentId = IdSchema.parse(crypto.randomUUID());
    this.options.control.recordIntent({
      id: intentId, operationId: id, supervisorEpoch: state.supervisorEpoch,
      generation: state.generation, kind, inputBytes: canonicalJson(input), createdAt: this.options.clock.now(),
    });
    return intentId;
  }
  private evidence(input: MigrationEvidence, operationId: Id, purpose?: MigrationEvidence["execution"]["purpose"]): MigrationEvidence {
    const evidence = Evidence.parse(input);
    const state = this.options.control.state();
    const recorded = this.options.control.executions().find(row => row.identity.id === evidence.execution.id);
    if (evidence.execution.operationId !== operationId || evidence.execution.installationId !== state.installationId ||
        evidence.execution.supervisorEpoch !== state.supervisorEpoch || evidence.execution.generation !== state.generation ||
        (purpose !== undefined && evidence.execution.purpose !== purpose) ||
        recorded === undefined || recorded.startedAt === null || recorded.exitedAt === null ||
        recorded.resultBytes !== evidence.resultBytes || canonicalJson(recorded.identity) !== canonicalJson(evidence.execution)) {
      throw new UpdateError("UPDATE_HELPER_RESULT_UNPROVEN");
    }
    return evidence;
  }
  private async perform<T>(
    id: Id, kind: ExecutionIntent["kind"], input: unknown, work: () => Promise<T>,
    local = false, resultValue: (result: T) => unknown = result => result,
  ): Promise<T> {
    const intentId = this.intent(id, kind, input);
    try {
      const result = await work();
      this.options.control.recordResult(intentId, "succeeded", canonicalJson(resultValue(result)), this.options.clock.now());
      return result;
    } catch (error) {
      if (error instanceof ReportedUpdateFailure) {
        if (!["backup", "preflight", "migration", "restore", "health"].includes(kind)) throw new UpdateError("UPDATE_HELPER_RESULT_UNPROVEN");
        this.evidence(error.evidence, id);
        if (error.evidence.execution.purpose !== kind) {
          const execution = error.evidence.execution;
          const proof = kind === "health" && execution.purpose === "prepared"
            ? this.options.control.completedHealthFailure(execution.id) : null;
          if (proof === null || proof.failedExecutionId !== execution.id ||
              proof.healthIntentId !== intentId || proof.operationId !== id ||
              proof.supervisorEpoch !== execution.supervisorEpoch || proof.generation !== execution.generation ||
              proof.bindingDigest !== controlDigest(canonicalJson(input)) ||
              proof.resultBytes !== error.evidence.resultBytes) {
            throw new UpdateError("UPDATE_HELPER_RESULT_UNPROVEN");
          }
        }
        this.options.control.recordResult(intentId, "failed", error.evidence.resultBytes, this.options.clock.now());
      } else if (local) {
        this.options.control.recordResult(intentId, "failed", canonicalJson({
          detail: error instanceof Error ? error.message : String(error),
        }), this.options.clock.now());
      }
      // A rejected host call without an acknowledged exited result is an
      // interruption. Its missing intent result is deliberately left missing.
      throw error;
    }
  }
  private async prepare(id: Id, stopped: StoppedInstallation, binding: InstallationBinding, migrationDigests: readonly z.infer<typeof DigestSchema>[]) {
    return this.perform(id, "health", binding, async () => {
      const prepared = await this.options.authority.prepare({ stopped, binding, expectedMigrationDigests: migrationDigests });
      if (prepared.stopped !== stopped || canonicalJson(prepared.binding) !== canonicalJson(binding)) {
        throw new UpdateError("UPDATE_PREPARED_BINDING_MISMATCH");
      }
      return prepared;
    }, false, prepared => ({ binding: prepared.binding, healthEvidenceDigest: prepared.healthEvidenceDigest }));
  }
  private async terminal(
    job: ControlReceipt, stopped: StoppedInstallation, binding: InstallationBinding,
    digests: readonly z.infer<typeof DigestSchema>[], errorCode: string | null, result: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const prepared = await this.prepare(job.command.operationId, stopped, binding, digests);
    this.options.control.progress(job.command.operationId, "prepared", 0.95, this.options.clock.now());
    const resultBytes = canonicalJson(result);
    const operation = OperationSchema.parse({
      ...job.operation, status: errorCode === null ? "succeeded" : "failed", progress: 1, result, errorCode,
    });
    await this.options.authority.commit({
      prepared, operation, resultBytes,
      successfulFloor: errorCode === null ? { sequence: job.release.sequence, version: job.release.version } : null,
    });
    const persisted = this.options.control.receipt(operation.id);
    if (this.options.control.state().mode !== "open" || persisted?.resultBytes !== resultBytes ||
        canonicalJson(persisted.operation) !== canonicalJson(operation) ||
        canonicalJson(this.options.control.state().binding) !== canonicalJson(binding)) throw new UpdateError("UPDATE_COMMIT_UNPROVEN");
  }
  private async install(job: ControlReceipt): Promise<void> {
    const id = job.command.operationId;
    const release = job.release;
    const prior = this.options.control.state().binding;
    let unlock: (() => Promise<void>) | null = null;
    let stopped: StoppedInstallation | null = null;
    let candidate: InstallationBinding | null = null;
    let backup: VerifiedInstallationBackup | null = null;
    try {
      assertWindow(this.config, this.options.clock.now());
      await this.capabilities();
      await this.options.authorizeActor(job.command.actorId);
      this.eligible(release, job.command.request.autoSecurity);
      const available = await discover(this.config, this.options.clock.now());
      if (!available.some(entry => entry.id === release.id && entry.manifestDigest === release.manifestDigest)) {
        throw new UpdateError("RELEASE_CHANGED_OR_WITHDRAWN");
      }
      unlock = await this.installer.lock(id);
      const pack = await fetchPackage(this.config, release);
      const staged = await this.perform(id, "stage", { release, entrypoint: pack.entrypoint },
        () => this.installer.stage(release, pack), true);
      if (join(this.config.installRoot, staged.prior) !== prior.release.target) throw new UpdateError("UPDATE_PRIOR_BINDING_MISMATCH");
      candidate = BindingSchema.parse({
        release: {
          target: join(this.config.installRoot, staged.staged), entrypoint: staged.entrypoint,
          releaseId: release.id, version: release.version, sequence: release.sequence,
          manifestDigest: release.manifestDigest, packageDigest: release.packageDigest,
        }, data: prior.data,
      });
      this.options.control.progress(id, "staged", 0.3, this.options.clock.now());
      // This durable write precedes any request to stop the old cohort.
      this.options.control.inhibit(id, this.options.clock.now());
      this.options.control.recovery(id, {
        candidate, backup: null, originalMigrationLedger: null, restoreResult: null,
      }, this.options.clock.now());
      stopped = await this.perform(id, "stop", { operationId: id }, async () => {
        const authority = await this.options.authority.stopForUpdate(id);
        const state = this.options.control.state();
        if (authority.operationId !== id || authority.installationId !== state.installationId ||
            authority.supervisorEpoch !== state.supervisorEpoch || authority.generation !== state.generation) {
          throw new UpdateError("UPDATE_STOPPED_AUTHORITY_MISMATCH");
        }
        return authority;
      }, false, authority => ({
        installationId: authority.installationId, operationId: authority.operationId,
        supervisorEpoch: authority.supervisorEpoch, generation: authority.generation, invocations: authority.invocations,
      }));
      const stoppedAuthority = stopped;
      const candidateBinding = candidate;
      await this.options.authority.withStopped(stoppedAuthority, async () => {
        backup = await this.perform(id, "backup", { prior }, async () => {
          const receipt = VerifiedBackup.parse(await this.options.storage.backup(stoppedAuthority));
          if (Date.parse(receipt.verifiedAt) < Date.parse(job.command.request.at) ||
              Date.parse(receipt.verifiedAt) > Date.parse(this.options.clock.now())) throw new UpdateError("BACKUP_NOT_CURRENT");
          return receipt;
        });
        const { originalMigrationLedger, ...backupReceipt } = backup;
        this.options.control.recovery(id, {
          candidate: candidateBinding, backup: backupReceipt, originalMigrationLedger, restoreResult: null,
        }, this.options.clock.now());
        this.options.control.progress(id, "backed_up", 0.5, this.options.clock.now());
        this.options.control.progress(id, "preflight", 0.55, this.options.clock.now());
        const preflight = await this.perform(id, "preflight", { candidate: candidateBinding, backup }, async () =>
          this.evidence(await this.options.storage.preflight({ stopped: stoppedAuthority, backup: VerifiedBackup.parse(backup), candidate: candidateBinding }), id, "preflight"));
        assertWindow(this.config, this.options.clock.now());
        this.options.control.progress(id, "migrating", 0.6, this.options.clock.now());
        const migrated = await this.perform(id, "migration", { candidate: candidateBinding }, async () =>
          this.evidence(await this.options.storage.migrate({
            stopped: stoppedAuthority, candidate: candidateBinding, originalMigrationLedger: VerifiedBackup.parse(backup).originalMigrationLedger,
          }), id, "migration"));
        await this.perform(id, "activation", candidateBinding, async () => {
          await this.installer.activate(staged.staged);
          return { target: candidateBinding.release.target };
        }, true);
        this.options.control.progress(id, "switched", 0.8, this.options.clock.now());
        await this.terminal(job, stoppedAuthority, candidateBinding, [...preflight.migrationDigests, ...migrated.migrationDigests],
          null, { releaseId: release.id, version: release.version, ...staged, backup, rolledBack: false });
      });
    } catch (error) {
      // Commit acknowledgment can be lost after its atomic transaction. Never
      // roll back a terminal/open generation, which may already accept writes.
      const current = this.options.control.receipt(id);
      if (current !== null && ["succeeded", "failed"].includes(current.operation.status)) return;
      const code = error instanceof UpdateError ? error.code : "UPDATE_FAILED";
      if (this.options.control.state().mode === "open") {
        this.options.control.finishUnchanged(id, code, canonicalJson({ releaseId: release.id,
          detail: error instanceof Error ? error.message : String(error) }), this.options.clock.now());
      } else if (error instanceof ReportedUpdateFailure && stopped !== null && candidate !== null &&
          this.options.control.state().mode === "installing") {
        try {
          this.evidence(error.evidence, id);
          const stoppedAuthority = stopped;
          const candidateBinding = candidate;
          await this.options.authority.withStopped(stoppedAuthority, async () => {
            let restored = prior;
            let migrationDigests: readonly z.infer<typeof DigestSchema>[] = [];
            const migrationIntent = this.options.control.receipt(id)?.recovery?.migrationIntent;
            if (migrationIntent !== null && migrationIntent !== undefined) {
              const verifiedBackup = VerifiedBackup.parse(backup);
              const restoration = await this.perform(id, "restore", { prior, backup: verifiedBackup }, async () => {
                const result = await this.options.storage.restore({
                  stopped: stoppedAuthority, backup: verifiedBackup, prior, retained: [prior, candidateBinding],
                });
                this.evidence(result.evidence, id, "restore");
                const binding = BindingSchema.parse(result.binding);
                if (canonicalJson(binding.release) !== canonicalJson(prior.release) ||
                    binding.data.dialect !== prior.data.dialect ||
                    [prior.data.generationId, candidateBinding.data.generationId].includes(binding.data.generationId)) {
                  throw new UpdateError("UPDATE_RESTORE_NOT_FRESH");
                }
                return { binding, evidence: result.evidence };
              });
              restored = restoration.binding;
              migrationDigests = restoration.evidence.migrationDigests;
              const { originalMigrationLedger, ...backupReceipt } = verifiedBackup;
              this.options.control.recovery(id, {
                candidate: candidateBinding, backup: backupReceipt,
                originalMigrationLedger, restoreResult: canonicalJson(restoration),
              }, this.options.clock.now());
            }
            await this.perform(id, "activation", restored, async () => {
              await this.installer.activate(relative(this.config.installRoot, prior.release.target));
              return { target: prior.release.target };
            }, true);
            await this.terminal(job, stoppedAuthority, restored, migrationDigests, code,
              { releaseId: release.id, rolledBack: restored !== prior, detail: error.message });
          });
        } catch (rollbackError) {
          if (this.options.control.receipt(id)?.operation.status === "running") {
            this.options.control.requireRecovery(id, "ROLLBACK_FAILED", this.options.clock.now());
          }
          throw rollbackError;
        }
      } else {
        this.options.control.requireRecovery(id, code, this.options.clock.now());
        throw error;
      }
    } finally {
      if (unlock !== null && this.options.control.state().mode === "open") await unlock();
    }
  }
  async recover(command: AuthenticatedControlCommand): Promise<Operation> {
    const state = this.options.control.beginRecovery(command, this.options.clock.now());
    if (state.operationId === null) throw new UpdateError("RECOVERY_NOT_REQUIRED");
    try {
      const result = await this.options.authority.recover({
        installationId: state.installationId, operationId: state.operationId,
        generation: state.generation, supervisorEpoch: state.supervisorEpoch,
      });
      const receipt = this.options.control.receipt(state.operationId);
      if (this.options.control.state().mode !== "open" || receipt?.operation.status !== "failed" ||
          canonicalJson(receipt.operation) !== canonicalJson(result)) throw new UpdateError("UPDATE_RECOVERY_UNPROVEN");
      await this.installer.recoverLock(state.operationId);
      return result;
    } catch (error) {
      if (this.options.control.receipt(state.operationId)?.operation.status === "running") {
        this.options.control.requireRecovery(state.operationId, "RECOVERY_FAILED", this.options.clock.now());
      }
      throw error;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.active) await this.active;
    this.listeners.clear();
  }
}
