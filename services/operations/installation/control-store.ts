import { Database } from "bun:sqlite";
import { closeSync, openSync } from "node:fs";
import { z } from "zod";
import { DigestSchema, IdSchema, InstantSchema, OperationSchema } from "@quire/contracts";
import type { Id, Instant, Operation } from "@quire/contracts";
import {
  AcceptedReleaseSchema, BindingSchema, ControlError, ControlReceiptSchema,
  ExecutionIdentitySchema, ExecutionRecordSchema, FloorSchema, InstallationStateSchema,
  PhaseSchema, RecoveryRecordSchema, ReservedUpdateCommandSchema, UpdateOperationQuerySchema,
} from "./model";
import type {
  AcceptedRelease, ControlReceipt, ExecutionIdentity, ExecutionRecord, InstallationState,
  RecoveryRecord, ReservedUpdateCommand, UpdateOperationQuery, UpdateOperationRow,
} from "./model";
import { canonicalJson, controlDigest, requestDigest } from "./protocol";
import { AuthenticatedControlCommand } from "./protocol";
import { controlMigration, controlMigrationDigest } from "./control-migrations";
import { LegacyReleaseSchema, LegacyRowsSchema, LegacySnapshotSchema } from "./legacy-import";
import type { LegacyCopyCheckpoint, LegacyRemovalResult, LegacySnapshot } from "./legacy-import";
import { CompletedHealthFailureSchema, PreparedFailureReportSchema, supervisorMigration, supervisorMigrationDigest } from "./execution-ledger";
import type { CompletedHealthFailure } from "./execution-ledger";
import { ExecutionExitSchema, ExecutionLaunchSchema } from "./execution-model";
import type { ExecutionExit, ExecutionLaunch } from "./execution-model";

const jsonRow = z.object({ value: z.string() });
const IntentSchema = z.strictObject({
  id: IdSchema, operationId: IdSchema, supervisorEpoch: IdSchema,
  generation: z.number().int().nonnegative(),
  kind: z.enum(["stage", "stop", "reconcile", "backup", "preflight", "migration", "activation", "restore", "health"]),
  inputBytes: z.string(), createdAt: InstantSchema,
  outcome: z.enum(["succeeded", "failed"]).nullable(),
  resultBytes: z.string().nullable(), completedAt: InstantSchema.nullable(),
}).readonly();
export type ExecutionIntent = z.infer<typeof IntentSchema>;
const StoppedEvidenceSchema = z.strictObject({
  observedAt: InstantSchema, inventoryDigest: DigestSchema, managerEvidenceBytes: z.string().min(1),
  executions: z.array(ExecutionIdentitySchema).readonly(),
}).readonly();
export type StoppedEvidence = z.infer<typeof StoppedEvidenceSchema>;
export const LedgerCommitSchema = z.strictObject({
  operationId: IdSchema, supervisorEpoch: IdSchema, generation: z.number().int().nonnegative(),
  binding: BindingSchema, healthIntentId: IdSchema,
  outcome: z.enum(["succeeded", "failed"]), errorCode: z.string().min(1).nullable(),
  resultBytes: z.string(), successfulFloor: FloorSchema.nullable(), at: InstantSchema,
}).readonly();
export type LedgerCommit = z.infer<typeof LedgerCommitSchema>;
function parseJson<T>(schema: z.ZodType<T>, value: string): T {
  const input: unknown = JSON.parse(value);
  return schema.parse(input);
}
function newer(next: string, previous: string): boolean {
  const a = next.split(".").map(BigInt);
  const b = previous.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    const left = a[i]; const right = b[i];
    if (left === undefined || right === undefined) throw new ControlError("CONTROL_INVALID_VERSION");
    if (left !== right) return left > right;
  }
  return false;
}
function operationRow(receipt: ControlReceipt): UpdateOperationRow {
  return {
    actorId: receipt.command.actorId, operation: receipt.operation,
    createdAt: receipt.createdAt, updatedAt: receipt.updatedAt,
  };
}

/**
 * Controller-only persistence. This is not a supervisor, launch gate, or
 * process-stopped capability. Caller must own controller.lock throughout.
 * No method opens or accepts an application SQL connection.
 */
export class ControlStore {
  private constructor(private readonly db: Database, private readonly epoch: Id) {}

  static provision(path: string, input: InstallationState): ControlStore {
    const state = InstallationStateSchema.parse(input);
    if (state.mode !== "open" || state.operationId !== null || state.generation !== 0) {
      throw new ControlError("CONTROL_INVALID_BOOTSTRAP");
    }
    if (controlDigest(canonicalJson(state.roleInventory)) !== state.roleInventoryDigest) {
      throw new ControlError("CONTROL_INVENTORY_INVALID");
    }
    // Exclusive creation separates explicit provisioning from reopening.
    const fd = openSync(path, "wx", 0o600);
    closeSync(fd);
    const db = new Database(path, { create: false, strict: true });
    const store = new ControlStore(db, state.supervisorEpoch);
    try {
      store.configure();
      store.transaction(() => {
        db.exec(controlMigration.sql);
        db.query("INSERT INTO control_migrations VALUES(?,?)").run(controlMigration.id, controlMigrationDigest);
        db.query("INSERT INTO installation VALUES(1,?)").run(JSON.stringify(state));
      });
      return store;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  static open(path: string, installationId: string, epoch: Id, at: Instant): ControlStore {
    let db: Database;
    try { db = new Database(path, { create: false, strict: true }); }
    catch { throw new ControlError("CONTROL_AUTHORITY_UNAVAILABLE"); }
    const store = new ControlStore(db, IdSchema.parse(epoch));
    try {
      store.configure();
      store.validate(installationId);
      store.transaction(() => {
        const state = store.state();
        const interrupted = store.receipts().filter(receipt => receipt.operation.status === "running");
        for (const receipt of interrupted) {
          store.writeReceipt(ControlReceiptSchema.parse({
            ...receipt, phase: "recovery_required", updatedAt: at,
            recovery: receipt.recovery ?? {
              prior: state.binding, candidate: null, backup: null, originalMigrationLedger: null,
              migrationIntent: null, activationIntent: null, restoreResult: null, lastCompletedStep: null,
            },
            operation: { ...receipt.operation, errorCode: receipt.operation.errorCode ?? "CONTROLLER_INTERRUPTED" },
          }));
        }
        const recovery = state.mode !== "open" || interrupted.length > 0;
        store.writeState({
          ...state, supervisorEpoch: epoch,
          mode: recovery ? "recovery_required" : "open",
          operationId: state.operationId ?? interrupted[0]?.command.operationId ?? null,
        });
      });
      return store;
    } catch {
      db.close();
      throw new ControlError("CONTROL_AUTHORITY_INVALID");
    }
  }

  private configure(): void {
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  }
  private validate(installationId: string): void {
    const integrity = z.object({ quick_check: z.literal("ok") }).parse(this.db.query("PRAGMA quick_check").get());
    if (integrity.quick_check !== "ok") throw new ControlError("CONTROL_AUTHORITY_INVALID");
    const migrations = z.array(z.object({ id: z.string(), digest: DigestSchema })).parse(
      this.db.query("SELECT id,digest FROM control_migrations").all(),
    );
    const original = migrations.find(migration => migration.id === controlMigration.id);
    if (original?.digest !== controlMigrationDigest || migrations.length < 1 || migrations.length > 2 ||
        migrations.some(migration => migration.id !== controlMigration.id &&
          (migration.id !== supervisorMigration.id || migration.digest !== supervisorMigrationDigest))) {
      throw new ControlError("CONTROL_MIGRATION_MISMATCH");
    }
    if (migrations.some(migration => migration.id === supervisorMigration.id)) {
      this.executionLaunches();
      for (const row of z.array(jsonRow).parse(this.db.query("SELECT record_json AS value FROM prepared_health_failures").all())) {
        parseJson(CompletedHealthFailureSchema, row.value);
      }
    }
    const state = this.state();
    if (state.installationId !== installationId) throw new ControlError("CONTROL_INSTALLATION_MISMATCH");
    if (controlDigest(canonicalJson(state.roleInventory)) !== state.roleInventoryDigest) {
      throw new ControlError("CONTROL_INVENTORY_INVALID");
    }
    const rows = z.array(z.object({
      operation_id: IdSchema, actor_id: IdSchema, request_key: z.string(), receipt_json: z.string(),
    })).parse(this.db.query("SELECT * FROM commands").all());
    for (const row of rows) {
      const receipt = parseJson(ControlReceiptSchema, row.receipt_json);
      if (receipt.command.operationId !== row.operation_id || receipt.operation.id !== row.operation_id ||
          receipt.command.actorId !== row.actor_id || receipt.command.key !== row.request_key ||
          receipt.command.installationId !== state.installationId ||
          requestDigest(receipt.command.request) !== receipt.command.requestDigest) {
        throw new ControlError("CONTROL_RECEIPT_CORRUPT");
      }
    }
    if ((state.mode === "open" && state.operationId !== null) ||
        (state.mode !== "open" && (state.operationId === null || this.receipt(state.operationId) === null))) {
      throw new ControlError("CONTROL_AUTHORITY_INVALID");
    }
    this.executions();
    for (const row of z.array(jsonRow).parse(this.db.query("SELECT record_json AS value FROM execution_intents").all())) {
      parseJson(IntentSchema, row.value);
    }
    for (const row of z.array(jsonRow).parse(this.db.query("SELECT evidence_json AS value FROM stopped_cohorts").all())) {
      parseJson(StoppedEvidenceSchema, row.value);
    }
    for (const row of z.array(z.object({ digest: DigestSchema, snapshot_bytes: z.string() })).parse(
      this.db.query("SELECT digest,snapshot_bytes FROM legacy_imports").all(),
    )) {
      if (controlDigest(row.snapshot_bytes) !== row.digest) throw new ControlError("CONTROL_IMPORT_CORRUPT");
    }
  }
  private transaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }
  private assertEpoch(state = this.state()): void {
    if (state.supervisorEpoch !== this.epoch) throw new ControlError("CONTROL_STALE_EPOCH");
  }
  state(): InstallationState {
    return parseJson(InstallationStateSchema, jsonRow.parse(
      this.db.query("SELECT state_json AS value FROM installation WHERE singleton=1").get(),
    ).value);
  }
  private writeState(state: InstallationState): void {
    this.db.query("UPDATE installation SET state_json=? WHERE singleton=1").run(
      JSON.stringify(InstallationStateSchema.parse(state)),
    );
  }
  receipt(id: Id): ControlReceipt | null {
    const row = jsonRow.nullable().parse(this.db.query("SELECT receipt_json AS value FROM commands WHERE operation_id=?").get(id));
    return row === null ? null : parseJson(ControlReceiptSchema, row.value);
  }
  private requireReceipt(id: Id): ControlReceipt {
    const receipt = this.receipt(id);
    if (receipt === null) throw new ControlError("CONTROL_OPERATION_NOT_FOUND");
    return receipt;
  }
  private receipts(): ControlReceipt[] {
    return z.array(jsonRow).parse(this.db.query("SELECT receipt_json AS value FROM commands").all())
      .map(row => parseJson(ControlReceiptSchema, row.value));
  }
  private writeReceipt(receipt: ControlReceipt): void {
    this.db.query("UPDATE commands SET receipt_json=? WHERE operation_id=?").run(
      JSON.stringify(ControlReceiptSchema.parse(receipt)), receipt.command.operationId,
    );
  }
  existing(input: ReservedUpdateCommand): ControlReceipt | null {
    const command = ReservedUpdateCommandSchema.parse(input);
    if (command.installationId !== this.state().installationId ||
        requestDigest(command.request) !== command.requestDigest) throw new ControlError("CONTROL_REQUEST_INVALID");
    const row = jsonRow.nullable().parse(this.db.query(
      "SELECT receipt_json AS value FROM commands WHERE actor_id=? AND request_key=?",
    ).get(command.actorId, command.key));
    if (row === null) {
      if (this.receipt(command.operationId) !== null) throw new ControlError("IDEMPOTENCY_CONFLICT");
      return null;
    }
    const receipt = parseJson(ControlReceiptSchema, row.value);
    if (canonicalJson(receipt.command) !== canonicalJson(command)) throw new ControlError("IDEMPOTENCY_CONFLICT");
    return receipt;
  }
  accept(input: ReservedUpdateCommand, releaseInput: AcceptedRelease, at: Instant): ControlReceipt {
    return this.transaction(() => {
      this.assertEpoch();
      const existing = this.existing(input);
      if (existing !== null) return existing;
      const state = this.state();
      if (state.mode !== "open") throw new ControlError("CONTROL_RECOVERY_REQUIRED");
      const command = ReservedUpdateCommandSchema.parse(input);
      const release = AcceptedReleaseSchema.parse(releaseInput);
      if (release.id !== command.request.releaseId) throw new ControlError("CONTROL_REQUEST_INVALID");
      if (release.sequence <= state.floor.sequence || !newer(release.version, state.floor.version)) {
        throw new ControlError("RELEASE_DOWNGRADE");
      }
      const receipt = ControlReceiptSchema.parse({
        command, release, phase: "queued", recovery: null, createdAt: at, updatedAt: at, resultBytes: null,
        operation: { id: command.operationId, kind: "update", status: "queued", progress: 0, result: null, errorCode: null },
      });
      this.db.query("INSERT INTO commands VALUES(?,?,?,?)").run(
        command.operationId, command.actorId, command.key, JSON.stringify(receipt),
      );
      return receipt;
    });
  }
  get(id: Id): UpdateOperationRow | null {
    const receipt = this.receipt(id);
    return receipt === null ? null : operationRow(receipt);
  }
  list(input: UpdateOperationQuery): readonly UpdateOperationRow[] {
    const query = UpdateOperationQuerySchema.parse(input);
    const ascending = query.order === "asc";
    const terms: string[] = [];
    const values: (string | number)[] = [];
    if (query.actorId !== undefined) { terms.push("actor_id=?"); values.push(query.actorId); }
    if (query.kind !== undefined) { terms.push("json_extract(receipt_json,'$.operation.kind')=?"); values.push(query.kind); }
    if (query.status !== undefined) { terms.push("json_extract(receipt_json,'$.operation.status')=?"); values.push(query.status); }
    if (query.cursor !== undefined) {
      terms.push(`operation_id ${ascending ? ">" : "<"} ?`); values.push(query.cursor);
    }
    const where = terms.length ? ` WHERE ${terms.join(" AND ")}` : "";
    const rows = this.db.query(`SELECT receipt_json AS value FROM commands${where}
      ORDER BY operation_id ${ascending ? "ASC" : "DESC"} LIMIT ?`).all(...values, query.limit);
    return z.array(jsonRow).parse(rows).map(row => operationRow(parseJson(ControlReceiptSchema, row.value)));
  }
  nextAt(): Instant | null {
    return this.receipts().filter(receipt => receipt.phase === "queued")
      .map(receipt => receipt.command.request.at).sort()[0] ?? null;
  }
  claimDue(at: Instant): ControlReceipt | null {
    return this.transaction(() => {
      const state = this.state();
      this.assertEpoch(state);
      if (state.mode !== "open" || this.receipts().some(receipt => receipt.operation.status === "running")) return null;
      const receipt = this.receipts().filter(row => row.phase === "queued" && row.command.request.at <= at)
        .sort((a, b) => a.command.request.at.localeCompare(b.command.request.at) || a.operation.id.localeCompare(b.operation.id))[0];
      if (receipt === undefined) return null;
      const claimed = ControlReceiptSchema.parse({
        ...receipt, phase: "validating", updatedAt: at,
        operation: { ...receipt.operation, status: "running", progress: 0.05 },
      });
      this.writeReceipt(claimed);
      return claimed;
    });
  }
  progress(id: Id, phaseInput: ControlReceipt["phase"], progress: number, at: Instant): void {
    this.transaction(() => {
      this.assertEpoch();
      const phase = PhaseSchema.parse(phaseInput);
      const receipt = this.requireReceipt(id);
      if (["queued", "succeeded", "failed", "recovery_required"].includes(phase) ||
          receipt.operation.status !== "running" || receipt.phase === "recovery_required") {
        throw new ControlError("CONTROL_INVALID_TRANSITION");
      }
      this.writeReceipt(ControlReceiptSchema.parse({
        ...receipt, phase, updatedAt: at, operation: { ...receipt.operation, progress },
      }));
    });
  }
  inhibit(id: Id, at: Instant): InstallationState {
    return this.transaction(() => {
      const state = this.state();
      this.assertEpoch(state);
      const receipt = this.requireReceipt(id);
      if (state.mode !== "open" || receipt.operation.status !== "running" || receipt.phase === "recovery_required") {
        throw new ControlError("CONTROL_INVALID_TRANSITION");
      }
      const next = InstallationStateSchema.parse({
        ...state, mode: "installing", operationId: id, generation: state.generation + 1,
      });
      this.writeState(next);
      this.writeReceipt(ControlReceiptSchema.parse({
        ...receipt, phase: "stopping", updatedAt: at,
        recovery: {
          prior: state.binding, candidate: null, backup: null, originalMigrationLedger: null,
          migrationIntent: null, activationIntent: null, restoreResult: null, lastCompletedStep: null,
        },
      }));
      return next;
    });
  }
  private closedOwner(id: Id): InstallationState {
    const state = this.state();
    this.assertEpoch(state);
    if (state.mode === "open" || state.operationId !== id) throw new ControlError("CONTROL_NOT_OWNER");
    return state;
  }
  recovery(id: Id, patch: Pick<RecoveryRecord, "candidate" | "backup" | "originalMigrationLedger" | "restoreResult">, at: Instant): void {
    this.transaction(() => {
      this.closedOwner(id);
      const receipt = this.requireReceipt(id);
      if (receipt.recovery === null) throw new ControlError("CONTROL_RECOVERY_MISSING");
      this.writeReceipt(ControlReceiptSchema.parse({
        ...receipt, updatedAt: at, recovery: RecoveryRecordSchema.parse({ ...receipt.recovery, ...patch }),
      }));
    });
  }
  requireRecovery(id: Id, errorCode: string, at: Instant): void {
    this.transaction(() => {
      const state = this.state();
      this.assertEpoch(state);
      const receipt = this.requireReceipt(id);
      if (receipt.operation.status !== "running" || (state.operationId !== null && state.operationId !== id)) {
        throw new ControlError("CONTROL_INVALID_TRANSITION");
      }
      this.writeState({ ...state, mode: "recovery_required", operationId: id });
      this.writeReceipt(ControlReceiptSchema.parse({
        ...receipt, phase: "recovery_required", updatedAt: at,
        recovery: receipt.recovery ?? {
          prior: state.binding, candidate: null, backup: null, originalMigrationLedger: null,
          migrationIntent: null, activationIntent: null, restoreResult: null, lastCompletedStep: null,
        },
        operation: { ...receipt.operation, errorCode },
      }));
    });
  }
  beginRecovery(authenticated: AuthenticatedControlCommand, at: Instant): InstallationState {
    return this.transaction(() => {
      const state = this.state();
      this.assertEpoch(state);
      const command = authenticated.envelope.command;
      if (!(authenticated instanceof AuthenticatedControlCommand) || authenticated.channel !== "operator" ||
          command.method !== "recover" || state.mode !== "recovery_required" ||
          command.input.installationId !== state.installationId || command.input.operationId !== state.operationId ||
          command.input.generation !== state.generation || command.input.supervisorEpoch !== state.supervisorEpoch) {
        throw new ControlError("CONTROL_RECOVERY_DENIED");
      }
      // Explicit recovery advances the generation before any new helper intent.
      const next = InstallationStateSchema.parse({ ...state, mode: "installing", generation: state.generation + 1 });
      this.writeState(next);
      const receipt = this.requireReceipt(command.input.operationId);
      this.writeReceipt({ ...receipt, updatedAt: at });
      return next;
    });
  }
  finishUnchanged(id: Id, errorCode: string, resultBytes: string, at: Instant): Operation {
    return this.transaction(() => {
      const state = this.state();
      this.assertEpoch(state);
      const receipt = this.requireReceipt(id);
      if (state.mode !== "open" || receipt.operation.status !== "running" ||
          !["validating", "staged"].includes(receipt.phase)) throw new ControlError("CONTROL_INVALID_TRANSITION");
      const operation = OperationSchema.parse({
        ...receipt.operation, status: "failed", progress: 1, errorCode,
        result: parseJson(z.record(z.string(), z.unknown()), resultBytes),
      });
      this.writeReceipt({ ...receipt, operation, phase: "failed", updatedAt: at, resultBytes });
      return operation;
    });
  }
  executions(): readonly ExecutionRecord[] {
    return z.array(jsonRow).parse(this.db.query("SELECT record_json AS value FROM executions").all())
      .map(row => parseJson(ExecutionRecordSchema, row.value));
  }
  installSupervisorExtensions(): void {
    this.transaction(() => {
      this.assertEpoch();
      const existing = this.db.query("SELECT digest FROM control_migrations WHERE id=?").get(supervisorMigration.id);
      if (existing !== null) {
        if (z.object({ digest: DigestSchema }).parse(existing).digest !== supervisorMigrationDigest) {
          throw new ControlError("CONTROL_MIGRATION_MISMATCH");
        }
        return;
      }
      this.db.exec(supervisorMigration.sql);
      this.db.query("INSERT INTO control_migrations VALUES(?,?)").run(supervisorMigration.id, supervisorMigrationDigest);
    });
  }
  executionLaunches(): readonly ExecutionLaunch[] {
    return z.array(jsonRow).parse(this.db.query("SELECT record_json AS value FROM execution_launches ORDER BY id").all())
      .map(row => parseJson(ExecutionLaunchSchema, row.value));
  }
  executionLaunch(id: Id): ExecutionLaunch | null {
    const row = jsonRow.nullable().parse(this.db.query("SELECT record_json AS value FROM execution_launches WHERE id=?").get(id));
    return row === null ? null : parseJson(ExecutionLaunchSchema, row.value);
  }
  reserveExecutionLaunch(input: ExecutionLaunch): ExecutionLaunch {
    return this.transaction(() => {
      const launch = ExecutionLaunchSchema.parse(input);
      const state = this.state();
      this.assertEpoch(state);
      const parent = this.executions().find(row => row.identity.id === launch.parentExecutionId);
      if (state.mode !== "open" || launch.installationId !== state.installationId ||
          launch.supervisorEpoch !== state.supervisorEpoch || launch.generation !== state.generation ||
          canonicalJson(launch.binding) !== canonicalJson(state.binding) || parent?.startedAt == null ||
          parent.exitedAt !== null || parent.identity.supervisorEpoch !== state.supervisorEpoch ||
          parent.identity.generation !== state.generation || !launch.profile.roles.includes(parent.identity.role) ||
          launch.requestDigest !== controlDigest(canonicalJson(launch.request)) ||
          launch.state !== "reserved" || launch.executionId !== null || launch.containerId !== null || launch.result !== null ||
          launch.unit !== `quire-${state.installationId}-exec-${launch.id}.service`) {
        throw new ControlError("CONTROL_EXECUTION_DENIED");
      }
      const old = this.executionLaunches().find(row =>
        row.parentExecutionId === launch.parentExecutionId && row.request.requestId === launch.request.requestId);
      if (old) {
        if (old.requestDigest !== launch.requestDigest) throw new ControlError("CONTROL_EXECUTION_CONFLICT");
        return old;
      }
      this.db.query("INSERT INTO execution_launches VALUES(?,?,?,?,?)").run(
        launch.id, launch.parentExecutionId, launch.request.requestId, launch.unit, JSON.stringify(launch),
      );
      return launch;
    });
  }
  private writeExecutionLaunch(launch: ExecutionLaunch): void {
    this.db.query("UPDATE execution_launches SET record_json=? WHERE id=?").run(JSON.stringify(ExecutionLaunchSchema.parse(launch)), launch.id);
  }
  recordExecutionContainer(id: Id, containerId: string): void {
    this.transaction(() => {
      this.assertEpoch();
      const launch = this.executionLaunch(id);
      if (!launch || launch.executionId !== null || launch.containerName === null ||
          (launch.containerId !== null && launch.containerId !== containerId)) throw new ControlError("CONTROL_EXECUTION_CONFLICT");
      this.writeExecutionLaunch({ ...launch, containerId });
    });
  }
  executionLaunchState(id: Id, next: "starting" | "stopping" | "released"): void {
    this.transaction(() => {
      this.assertEpoch();
      const launch = this.executionLaunch(id);
      if (!launch || (next === "starting" && (launch.state !== "reserved" || this.state().mode !== "open")) ||
          (next === "released" && !["exited", "interrupted", "released"].includes(launch.state))) {
        throw new ControlError("CONTROL_EXECUTION_CONFLICT");
      }
      this.writeExecutionLaunch({ ...launch, state: next });
    });
  }
  bindExecutionLaunch(id: Id, input: ExecutionIdentity, at: Instant): ExecutionRecord {
    return this.transaction(() => {
      this.assertEpoch();
      const launch = this.executionLaunch(id);
      const state = this.state();
      const identity = ExecutionIdentitySchema.parse(input);
      if (!launch || launch.state !== "starting" || state.mode !== "open" ||
          identity.unit !== launch.unit || identity.installationId !== state.installationId ||
          identity.generation !== state.generation || identity.supervisorEpoch !== state.supervisorEpoch ||
          identity.operationId !== null || identity.purpose !== "ordinary" || launch.executionId !== null ||
          identity.role !== (launch.profile.workerRole ?? "execution") ||
          canonicalJson(identity.containerIds) !== canonicalJson(launch.containerId ? [launch.containerId] : [])) {
        throw new ControlError("CONTROL_EXECUTION_DENIED");
      }
      const record = ExecutionRecordSchema.parse({ identity, intentAt: launch.createdAt, startedAt: at, exitedAt: null, resultBytes: null });
      this.db.query("INSERT INTO executions VALUES(?,?,?,?)").run(identity.id, identity.unit, identity.invocationId, JSON.stringify(record));
      this.writeExecutionLaunch({ ...launch, executionId: identity.id, state: "running" });
      return record;
    });
  }
  completeExecutionLaunch(id: Id, input: ExecutionExit, at: Instant): void {
    this.transaction(() => {
      this.assertEpoch();
      const result = ExecutionExitSchema.parse(input);
      const launch = this.executionLaunch(id);
      if (!launch || result.id !== id || ["exited", "interrupted", "released"].includes(launch.state)) {
        if (launch?.result && canonicalJson(launch.result) === canonicalJson(result)) return;
        throw new ControlError("CONTROL_EXECUTION_CONFLICT");
      }
      if (launch.executionId !== null) this.acknowledgeExecution(launch.executionId, "exited", at, canonicalJson(result));
      this.writeExecutionLaunch({ ...launch, state: result.interrupted ? "interrupted" : "exited", result });
    });
  }
  reportExecutionLaunch(id: Id, input: ExecutionExit): void {
    this.transaction(() => {
      this.assertEpoch();
      const launch = this.executionLaunch(id);
      const report = ExecutionExitSchema.parse(input);
      if (!launch || launch.executionId === null || report.id !== id ||
          !["running", "stopping"].includes(launch.state)) throw new ControlError("CONTROL_EXECUTION_RESULT_INVALID");
      if (launch.report && canonicalJson(launch.report) !== canonicalJson(report)) throw new ControlError("CONTROL_EXECUTION_CONFLICT");
      this.writeExecutionLaunch({ ...launch, report });
    });
  }
  executionPayloadStarted(id: Id, at: Instant): void {
    this.transaction(() => {
      this.assertEpoch();
      const launch = this.executionLaunch(id);
      if (!launch || !launch.executionId || !["running", "stopping"].includes(launch.state)) {
        throw new ControlError("CONTROL_EXECUTION_DENIED");
      }
      if (launch.payloadStartedAt === null) this.writeExecutionLaunch({ ...launch, payloadStartedAt: at });
    });
  }
  completedHealthFailure(executionId: Id): CompletedHealthFailure | null {
    const row = jsonRow.nullable().parse(this.db.query(
      "SELECT record_json AS value FROM prepared_health_failures WHERE execution_id=?",
    ).get(executionId));
    return row === null ? null : parseJson(CompletedHealthFailureSchema, row.value);
  }
  preparedFailureReport(executionId: Id): string | null {
    const row = z.object({ report_bytes: z.string() }).nullable().parse(this.db.query(
      "SELECT report_bytes FROM prepared_failure_reports WHERE execution_id=?",
    ).get(executionId));
    return row?.report_bytes ?? null;
  }
  reportPreparedFailure(executionId: Id, bytes: string): void {
    this.transaction(() => {
      this.assertEpoch();
      const report = parseJson(PreparedFailureReportSchema, bytes);
      const state = this.state();
      const execution = this.executions().find(row => row.identity.id === executionId);
      if (canonicalJson(report) !== bytes || state.mode !== "installing" || !execution ||
          execution.identity.purpose !== "prepared" || execution.startedAt === null || execution.exitedAt !== null ||
          execution.identity.operationId !== state.operationId || execution.identity.supervisorEpoch !== state.supervisorEpoch ||
          execution.identity.generation !== state.generation) throw new ControlError("CONTROL_HEALTH_REPORT_DENIED");
      const old = this.preparedFailureReport(executionId);
      if (old !== null) {
        if (old !== bytes) throw new ControlError("CONTROL_EXECUTION_CONFLICT");
        return;
      }
      this.db.query("INSERT INTO prepared_failure_reports VALUES(?,?)").run(executionId, bytes);
    });
  }
  recordCompletedHealthFailure(input: CompletedHealthFailure): void {
    this.transaction(() => {
      const proof = CompletedHealthFailureSchema.parse(input);
      const state = this.closedOwner(proof.operationId);
      const health = this.intent(proof.healthIntentId);
      const executions = this.executions();
      const failed = executions.find(row => row.identity.id === proof.failedExecutionId);
      const cohort = executions.filter(row => row.identity.operationId === proof.operationId &&
        row.identity.supervisorEpoch === state.supervisorEpoch && row.identity.generation === state.generation &&
        row.identity.purpose === "prepared");
      if (state.mode !== "installing" || proof.supervisorEpoch !== state.supervisorEpoch || proof.generation !== state.generation ||
          !failed || failed.identity.purpose !== "prepared" || failed.startedAt === null || failed.exitedAt === null ||
          failed.identity.operationId !== proof.operationId || failed.identity.supervisorEpoch !== state.supervisorEpoch ||
          failed.identity.generation !== state.generation ||
          failed.resultBytes !== proof.resultBytes || health?.kind !== "health" || health.operationId !== proof.operationId ||
          health.supervisorEpoch !== state.supervisorEpoch || health.generation !== state.generation ||
          proof.bindingDigest !== controlDigest(health.inputBytes) || proof.stopEvidenceDigest !== controlDigest(proof.stopEvidenceBytes) ||
          executions.some(row => row.exitedAt === null) ||
          this.executionLaunches().some(launch => !["exited", "interrupted", "released"].includes(launch.state)) ||
          canonicalJson(proof.drainedExecutions) !== canonicalJson(cohort.map(row => row.identity))) {
        throw new ControlError("CONTROL_HEALTH_FAILURE_UNPROVEN");
      }
      const old = this.completedHealthFailure(proof.failedExecutionId);
      if (old) {
        if (canonicalJson(old) !== canonicalJson(proof)) throw new ControlError("CONTROL_EXECUTION_CONFLICT");
        return;
      }
      this.db.query("INSERT INTO prepared_health_failures VALUES(?,?)").run(proof.failedExecutionId, JSON.stringify(proof));
    });
  }
  executionIntent(identityInput: ExecutionIdentity, at: Instant): ExecutionRecord {
    return this.transaction(() => {
      const identity = ExecutionIdentitySchema.parse(identityInput);
      const state = this.state();
      this.assertEpoch(state);
      if (identity.installationId !== state.installationId || identity.supervisorEpoch !== state.supervisorEpoch ||
          identity.generation !== state.generation ||
          (identity.purpose === "ordinary" ? state.mode !== "open" || identity.operationId !== null :
            state.mode !== "installing" || identity.operationId !== state.operationId)) {
        throw new ControlError("CONTROL_EXECUTION_DENIED");
      }
      if (identity.purpose === "ordinary" &&
          !state.roleInventory.some(role => role.role === identity.role && role.unit === identity.unit)) {
        throw new ControlError("CONTROL_EXECUTION_DENIED");
      }
      const existing = this.executions().find(record => record.identity.id === identity.id);
      if (existing !== undefined) {
        if (canonicalJson(existing.identity) !== canonicalJson(identity)) throw new ControlError("CONTROL_EXECUTION_CONFLICT");
        return existing;
      }
      const record = ExecutionRecordSchema.parse({ identity, intentAt: at, startedAt: null, exitedAt: null, resultBytes: null });
      this.db.query("INSERT INTO executions VALUES(?,?,?,?)").run(
        identity.id, identity.unit, identity.invocationId, JSON.stringify(record),
      );
      return record;
    });
  }
  acknowledgeExecution(id: Id, event: "started" | "exited", at: Instant, resultBytes: string | null = null): void {
    this.transaction(() => {
      this.assertEpoch();
      const record = this.executions().find(row => row.identity.id === id);
      if (record === undefined) throw new ControlError("CONTROL_EXECUTION_NOT_FOUND");
      if (event === "started" && record.exitedAt !== null) throw new ControlError("CONTROL_EXECUTION_CONFLICT");
      if (event === "started" && (record.identity.supervisorEpoch !== this.epoch ||
          record.identity.generation !== this.state().generation ||
          (record.identity.purpose === "ordinary" && this.state().mode !== "open"))) {
        throw new ControlError("CONTROL_EXECUTION_DENIED");
      }
      const existingAt = event === "started" ? record.startedAt : record.exitedAt;
      if (existingAt !== null && (existingAt !== at || (event === "exited" && record.resultBytes !== resultBytes))) {
        throw new ControlError("CONTROL_EXECUTION_CONFLICT");
      }
      if (existingAt !== null) return;
      const next = event === "started" ? { ...record, startedAt: at } : { ...record, exitedAt: at, resultBytes };
      this.db.query("UPDATE executions SET record_json=? WHERE id=?").run(JSON.stringify(next), id);
      if (event === "exited" && resultBytes === null && record.identity.purpose !== "ordinary" &&
          record.identity.operationId !== null) {
        this.requireRecovery(record.identity.operationId, "HELPER_INTERRUPTED", at);
      }
    });
  }
  recordStopped(id: Id, evidenceInput: StoppedEvidence, at: Instant): void {
    this.transaction(() => {
      const state = this.closedOwner(id);
      const evidence = StoppedEvidenceSchema.parse(evidenceInput);
      const executions = this.executions();
      if (evidence.inventoryDigest !== state.roleInventoryDigest ||
          executions.some(record => record.exitedAt === null) ||
          canonicalJson(evidence.executions) !== canonicalJson(executions.map(record => record.identity))) {
        throw new ControlError("CONTROL_EXECUTIONS_UNSETTLED");
      }
      const old = this.db.query(
        "SELECT evidence_json AS value FROM stopped_cohorts WHERE operation_id=? AND generation=? AND epoch=?",
      ).get(id, state.generation, state.supervisorEpoch);
      if (old !== null) {
        if (canonicalJson(parseJson(StoppedEvidenceSchema, jsonRow.parse(old).value)) !== canonicalJson(evidence)) {
          throw new ControlError("CONTROL_STOPPED_CONFLICT");
        }
        return;
      }
      this.db.query("INSERT INTO stopped_cohorts VALUES(?,?,?,?)").run(
        id, state.generation, state.supervisorEpoch, JSON.stringify(evidence),
      );
      const receipt = this.requireReceipt(id);
      this.writeReceipt({ ...receipt, phase: "stopped", updatedAt: at });
    });
  }
  /** Actual driver-observed exit after beginRecovery; never invents a lost helper result. */
  acknowledgeRecoveredExit(id: Id, at: Instant): void {
    this.transaction(() => {
      const state = this.state();
      this.assertEpoch(state);
      const record = this.executions().find(row => row.identity.id === id);
      if (state.mode !== "installing" || state.operationId === null || record === undefined ||
          record.identity.operationId !== state.operationId ||
          (record.identity.supervisorEpoch === state.supervisorEpoch && record.identity.generation >= state.generation)) {
        throw new ControlError("CONTROL_RECOVERY_AUTHORIZATION_REQUIRED");
      }
      if (record.exitedAt !== null) return;
      this.db.query("UPDATE executions SET record_json=? WHERE id=?").run(
        JSON.stringify({ ...record, exitedAt: at }), id,
      );
    });
  }
  /** A committed prepared role is ordinary service lifetime after commit, not an interrupted helper. */
  acknowledgeReplacedRoleExit(id: Id, at: Instant): void {
    this.transaction(() => {
      const state = this.state();
      this.assertEpoch(state);
      const record = this.executions().find(row => row.identity.id === id);
      const receipt = record?.identity.operationId ? this.receipt(record.identity.operationId) : null;
      if (record === undefined || record.identity.purpose !== "prepared" ||
          record.identity.supervisorEpoch === state.supervisorEpoch ||
          receipt === null || !["succeeded", "failed"].includes(receipt.operation.status)) {
        throw new ControlError("CONTROL_EXECUTION_DENIED");
      }
      if (record.exitedAt !== null) return;
      this.db.query("UPDATE executions SET record_json=? WHERE id=?").run(
        JSON.stringify({ ...record, exitedAt: at }), id,
      );
    });
  }
  recordIntent(input: Omit<ExecutionIntent, "outcome" | "resultBytes" | "completedAt">): ExecutionIntent {
    return this.transaction(() => {
      const intent = IntentSchema.parse({ ...input, outcome: null, resultBytes: null, completedAt: null });
      const state = this.state();
      this.assertEpoch(state);
      const receipt = this.requireReceipt(intent.operationId);
      if (intent.supervisorEpoch !== state.supervisorEpoch || intent.generation !== state.generation ||
          receipt.operation.status !== "running") throw new ControlError("CONTROL_NOT_OWNER");
      if (intent.kind === "stage") {
        if (state.mode !== "open" || !["validating", "staged"].includes(receipt.phase)) {
          throw new ControlError("CONTROL_INVALID_TRANSITION");
        }
      } else {
        this.closedOwner(intent.operationId);
        if (intent.kind !== "stop" && state.mode === "recovery_required") {
          throw new ControlError("CONTROL_RECOVERY_AUTHORIZATION_REQUIRED");
        }
        if (intent.kind !== "stop" && this.db.query(
          "SELECT 1 FROM stopped_cohorts WHERE operation_id=? AND generation=? AND epoch=?",
        ).get(intent.operationId, state.generation, state.supervisorEpoch) === null) {
          throw new ControlError("CONTROL_STOPPED_EVIDENCE_REQUIRED");
        }
      }
      if (intent.kind === "migration" && (receipt.recovery?.backup === null ||
          receipt.recovery?.originalMigrationLedger === null || receipt.recovery === null)) {
        throw new ControlError("CONTROL_BACKUP_REQUIRED");
      }
      const previous = this.intent(intent.id);
      if (previous !== null) {
        if (canonicalJson({ ...previous, outcome: null, resultBytes: null, completedAt: null }) !== canonicalJson(intent)) {
          throw new ControlError("CONTROL_INTENT_CONFLICT");
        }
        return previous;
      }
      this.db.query("INSERT INTO execution_intents VALUES(?,?,?)").run(intent.id, intent.operationId, JSON.stringify(intent));
      if (receipt.recovery !== null && (intent.kind === "migration" || intent.kind === "activation")) {
        this.writeReceipt({
          ...receipt, recovery: {
            ...receipt.recovery,
            ...(intent.kind === "migration" ? { migrationIntent: intent.id } : { activationIntent: intent.id }),
          },
        });
      }
      return intent;
    });
  }
  intent(id: Id): ExecutionIntent | null {
    const row = jsonRow.nullable().parse(this.db.query("SELECT record_json AS value FROM execution_intents WHERE id=?").get(id));
    return row === null ? null : parseJson(IntentSchema, row.value);
  }
  intents(operationId: Id): readonly ExecutionIntent[] {
    return z.array(jsonRow).parse(this.db.query(
      "SELECT record_json AS value FROM execution_intents WHERE operation_id=? ORDER BY id",
    ).all(operationId)).map(row => parseJson(IntentSchema, row.value));
  }
  recordResult(id: Id, outcome: "succeeded" | "failed", resultBytes: string, at: Instant): void {
    this.transaction(() => {
      this.assertEpoch();
      const intent = this.intent(id);
      if (intent === null) throw new ControlError("CONTROL_INTENT_NOT_FOUND");
      if (intent.supervisorEpoch !== this.epoch || intent.generation !== this.state().generation) {
        throw new ControlError("CONTROL_STALE_EPOCH");
      }
      if (intent.outcome !== null && (intent.outcome !== outcome || intent.resultBytes !== resultBytes || intent.completedAt !== at)) {
        throw new ControlError("CONTROL_INTENT_CONFLICT");
      }
      if (intent.outcome !== null) return;
      this.db.query("UPDATE execution_intents SET record_json=? WHERE id=?").run(
        JSON.stringify({ ...intent, outcome, resultBytes, completedAt: at }), id,
      );
      const receipt = this.requireReceipt(intent.operationId);
      if (receipt.operation.status !== "running") throw new ControlError("CONTROL_INVALID_TRANSITION");
      if (receipt.recovery !== null) {
        this.writeReceipt({ ...receipt, recovery: { ...receipt.recovery, lastCompletedStep: id }, updatedAt: at });
      }
    });
  }
  commit(input: LedgerCommit): Operation {
    const commit = LedgerCommitSchema.parse(input);
    return this.transaction(() => {
      const state = this.closedOwner(commit.operationId);
      const receipt = this.requireReceipt(commit.operationId);
      const health = this.intent(commit.healthIntentId);
      if (state.mode !== "installing" || state.generation !== commit.generation || state.supervisorEpoch !== commit.supervisorEpoch ||
          health === null || health.operationId !== commit.operationId ||
          health.supervisorEpoch !== state.supervisorEpoch || health.generation !== state.generation ||
          health.kind !== "health" || health.outcome !== "succeeded" ||
          health.inputBytes !== canonicalJson(commit.binding) ||
          this.receipts().some(row => row.command.operationId !== commit.operationId && row.phase === "recovery_required")) {
        throw new ControlError("CONTROL_COMMIT_DENIED");
      }
      if (this.executions().some(row => row.exitedAt === null &&
          (row.identity.supervisorEpoch !== state.supervisorEpoch || row.identity.generation !== state.generation ||
            row.identity.operationId !== commit.operationId || row.identity.purpose !== "prepared"))) {
        throw new ControlError("CONTROL_EXECUTIONS_UNSETTLED");
      }
      const intents = this.intents(commit.operationId);
      if (intents.some(intent => intent.outcome === null &&
          intent.supervisorEpoch === state.supervisorEpoch && intent.generation === state.generation)) {
        throw new ControlError("CONTROL_RESULT_MISSING");
      }
      if (commit.outcome === "succeeded") {
        if (receipt.operation.errorCode !== null || commit.errorCode !== null || commit.successfulFloor === null ||
            commit.successfulFloor.sequence !== receipt.release.sequence ||
            commit.successfulFloor.version !== receipt.release.version ||
            commit.binding.release.releaseId !== receipt.release.id ||
            commit.binding.release.manifestDigest !== receipt.release.manifestDigest ||
            commit.binding.release.packageDigest !== receipt.release.packageDigest ||
            commit.binding.release.sequence !== commit.successfulFloor.sequence ||
            commit.binding.release.version !== commit.successfulFloor.version ||
            commit.successfulFloor.sequence <= state.floor.sequence ||
            !newer(commit.successfulFloor.version, state.floor.version)) throw new ControlError("RELEASE_DOWNGRADE");
        if (intents.some(intent => intent.outcome === "failed")) throw new ControlError("CONTROL_COMMIT_DENIED");
      } else if (commit.successfulFloor !== null || commit.errorCode === null ||
          canonicalJson(commit.binding.release) !== canonicalJson(receipt.recovery?.prior.release)) {
        throw new ControlError("CONTROL_COMMIT_DENIED");
      }
      if (commit.outcome === "failed") {
        const recovery = receipt.recovery;
        if (recovery === null || (recovery.migrationIntent === null
          ? canonicalJson(commit.binding) !== canonicalJson(recovery.prior)
          : recovery.restoreResult === null || commit.binding.data.generationId === recovery.prior.data.generationId ||
            commit.binding.data.generationId === recovery.candidate?.data.generationId ||
            commit.binding.data.dialect !== recovery.prior.data.dialect)) {
          throw new ControlError("CONTROL_RESTORE_REQUIRED");
        }
      }
      const operation = OperationSchema.parse({
        ...receipt.operation, status: commit.outcome, progress: 1,
        result: parseJson(z.record(z.string(), z.unknown()), commit.resultBytes), errorCode: commit.errorCode,
      });
      this.writeReceipt({
        ...receipt, operation, phase: commit.outcome, resultBytes: commit.resultBytes, updatedAt: commit.at,
      });
      this.writeState({
        ...state, binding: commit.binding, floor: commit.successfulFloor ?? state.floor,
        mode: "open", operationId: null,
      });
      return operation;
    });
  }
  legacyImport(sourceId: string): LegacyCopyCheckpoint | null {
    const row = z.object({
      source_id: z.string(), digest: DigestSchema, snapshot_bytes: z.string(),
      copied_at: InstantSchema, removed_at: InstantSchema.nullable(), removal_receipt_bytes: z.string().nullable(),
    }).nullable().parse(this.db.query("SELECT * FROM legacy_imports WHERE source_id=?").get(sourceId));
    if (row === null) return null;
    if (controlDigest(row.snapshot_bytes) !== row.digest) throw new ControlError("CONTROL_IMPORT_CORRUPT");
    return {
      sourceId: row.source_id, digest: row.digest, snapshotBytes: row.snapshot_bytes,
      copiedAt: row.copied_at, removedAt: row.removed_at, removalReceiptBytes: row.removal_receipt_bytes,
    };
  }
  copyLegacy(input: LegacySnapshot, at: Instant): LegacyCopyCheckpoint {
    const snapshot = LegacySnapshotSchema.parse(input);
    const bytes = JSON.stringify(snapshot);
    const digest = controlDigest(bytes);
    return this.transaction(() => {
      const state = this.state();
      this.assertEpoch(state);
      if (snapshot.installationId !== state.installationId) throw new ControlError("CONTROL_IMPORT_IDENTITY_CONFLICT");
      const old = this.legacyImport(snapshot.sourceId);
      if (old !== null) {
        if (old.snapshotBytes !== bytes || old.digest !== digest) throw new ControlError("CONTROL_IMPORT_CONFLICT");
        return old;
      }
      if (state.mode === "installing" || this.executions().some(row => row.exitedAt === null)) {
        throw new ControlError("CONTROL_IMPORT_UNSETTLED");
      }
      const rows = parseJson(LegacyRowsSchema, snapshot.rowsBytes);
      const jobIds = new Set(rows.jobs.map(row => row.operation_id));
      const operationIds = new Set(rows.operations.map(row => row.id));
      if (jobIds.size !== rows.jobs.length || operationIds.size !== rows.operations.length ||
          rows.jobs.length !== rows.operations.length || rows.operations.some(row => !jobIds.has(row.id))) {
        throw new ControlError("CONTROL_IMPORT_INCOMPLETE");
      }
      let floor = state.floor;
      const advanceFloor = (next: InstallationState["floor"]) => {
        if (next.sequence > floor.sequence) {
          if (!newer(next.version, floor.version)) throw new ControlError("CONTROL_IMPORT_FLOOR_CONFLICT");
          floor = FloorSchema.parse({ sequence: next.sequence, version: next.version });
        } else if (next.sequence === floor.sequence && next.version !== floor.version) {
          throw new ControlError("CONTROL_IMPORT_FLOOR_CONFLICT");
        } else if (next.sequence < floor.sequence && newer(next.version, floor.version)) {
          throw new ControlError("CONTROL_IMPORT_FLOOR_CONFLICT");
        }
      };
      for (const row of rows.floors) {
        if (row.install_id !== state.installationId) throw new ControlError("CONTROL_IMPORT_IDENTITY_CONFLICT");
        advanceFloor(row);
      }
      let interruptedId = state.operationId;
      for (const job of rows.jobs) {
        const row = rows.operations.find(operation => operation.id === job.operation_id);
        if (row === undefined) throw new ControlError("CONTROL_IMPORT_INCOMPLETE");
        const release = parseJson(LegacyReleaseSchema, job.release_json);
        const request = { releaseId: release.id, at: job.scheduled_at, autoSecurity: Boolean(job.security_only) };
        const command = ReservedUpdateCommandSchema.parse({
          installationId: state.installationId, operationId: row.id, actorId: row.actor_id,
          key: row.idempotency_key, request, requestDigest: requestDigest(request),
        });
        // A new source receipt cannot overwrite an existing command, even if its
        // semantic projection happens to match: only a matching copy checkpoint
        // proves the byte-exact original was already imported.
        if (this.existing(command) !== null) throw new ControlError("CONTROL_IMPORT_CONFLICT");
        const interrupted = row.status === "running" ||
          !["queued", "succeeded", "failed"].includes(job.phase);
        if ((job.phase === "queued" && row.status !== "queued") ||
            (job.phase === "succeeded" && row.status !== "succeeded") ||
            (row.status === "succeeded" && job.phase !== "succeeded")) {
          throw new ControlError("CONTROL_IMPORT_INCONSISTENT");
        }
        if (interrupted) interruptedId ??= row.id;
        if (row.status === "succeeded") advanceFloor(release);
        const operation = OperationSchema.parse({
          id: row.id, kind: row.kind, status: row.status, progress: row.progress,
          result: row.result_json === null ? null : parseJson(z.record(z.string(), z.unknown()), row.result_json),
          errorCode: row.error_code,
        });
        const receipt = ControlReceiptSchema.parse({
          command, release, operation, phase: interrupted ? "recovery_required" : job.phase,
          resultBytes: row.result_json, createdAt: row.created_at, updatedAt: row.updated_at,
          recovery: {
            prior: state.binding, candidate: null, backup: null,
            originalMigrationLedger: snapshot.migrationLedgerBytes,
            migrationIntent: ["migrating", "switched", "recovery_required"].includes(job.phase)
              ? `legacy-unresolved:${row.id}` : null,
            activationIntent: null, restoreResult: null,
            lastCompletedStep: job.phase,
          },
        });
        this.db.query("INSERT INTO commands VALUES(?,?,?,?)").run(row.id, row.actor_id, row.idempotency_key, JSON.stringify(receipt));
      }
      this.writeState({
        ...state, floor, operationId: interruptedId,
        mode: interruptedId === null ? state.mode : "recovery_required",
      });
      this.db.query("INSERT INTO legacy_imports VALUES(?,?,?,?,NULL,NULL)").run(snapshot.sourceId, digest, bytes, at);
      return {
        sourceId: snapshot.sourceId, digest, snapshotBytes: bytes,
        copiedAt: at, removedAt: null, removalReceiptBytes: null,
      };
    });
  }
  confirmLegacyRemoval(input: LegacyRemovalResult, at: Instant): LegacyCopyCheckpoint {
    return this.transaction(() => {
      this.assertEpoch();
      const checkpoint = this.legacyImport(input.sourceId);
      if (checkpoint === null || checkpoint.digest !== input.digest || input.receiptBytes.length === 0) {
        throw new ControlError("CONTROL_IMPORT_REMOVAL_UNPROVEN");
      }
      if (checkpoint.removedAt !== null) {
        if (checkpoint.removalReceiptBytes !== input.receiptBytes) throw new ControlError("CONTROL_IMPORT_CONFLICT");
        return checkpoint;
      }
      this.db.query("UPDATE legacy_imports SET removed_at=?,removal_receipt_bytes=? WHERE source_id=? AND digest=?")
        .run(at, input.receiptBytes, input.sourceId, input.digest);
      return { ...checkpoint, removedAt: at, removalReceiptBytes: input.receiptBytes };
    });
  }
  close(): void { this.db.close(); }
  [Symbol.dispose](): void { this.close(); }
}
