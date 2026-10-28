import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ControlStore } from "../../../services/operations/installation/control-store";
import { BindingSchema } from "../../../services/operations/installation/model";
import { canonicalJson, requestDigest } from "../../../services/operations/installation/protocol";
import { at, controlFixture, hash, id, later } from "./control-fixture";

describe("independent installation control ledger", () => {
  test("durable identity, schema ledger, FULL sync and exact cleanup", async () => {
    const fixture = await controlFixture();
    const root = fixture.root;
    try {
      const initial = fixture.store.state();
      using inspection = new Database(fixture.path, { create: false });
      expect(inspection.query("SELECT id FROM control_migrations").all()).toEqual([{ id: "001-installation-control" }]);
      expect(inspection.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
      expect(inspection.query("SELECT name FROM sqlite_master WHERE name IN ('operations','schema_migrations')").all()).toEqual([]);
      fixture.reopen();
      expect(fixture.store.state()).toEqual({ ...initial, supervisorEpoch: fixture.store.state().supervisorEpoch });
      expect(() => ControlStore.provision(fixture.path, initial)).toThrow();
      expect(() => ControlStore.open(join(root, "missing.sqlite"), initial.installationId, id(), at)).toThrow("CONTROL_AUTHORITY_UNAVAILABLE");
      expect(existsSync(join(root, "missing.sqlite"))).toBe(false);
    } finally { await fixture[Symbol.asyncDispose](); }
    expect(existsSync(root)).toBe(false);
  });

  test("missing singleton, corrupt migration digest and corrupt JSON fail closed", async () => {
    for (const corruption of [
      "DELETE FROM installation",
      "UPDATE control_migrations SET digest='" + "0".repeat(64) + "'",
      "UPDATE installation SET state_json='{}'",
      "DROP TABLE executions",
    ]) {
      await using fixture = await controlFixture();
      using db = new Database(fixture.path, { create: false });
      db.exec(corruption);
      expect(() => ControlStore.open(fixture.path, "fixture-install", id(), at)).toThrow("CONTROL_AUTHORITY_INVALID");
    }
  });

  test("exact retries return original receipt, changed inputs and operation ID conflict", async () => {
    await using fixture = await controlFixture();
    const command = fixture.command();
    const first = fixture.store.accept(command, fixture.release, at);
    fixture.reopen();
    expect(fixture.store.existing(command)).toEqual(first);
    expect(fixture.store.accept(command, { ...fixture.release, notes: "feed changed" }, later)).toEqual(first);
    expect(() => fixture.store.existing({ ...command, operationId: id() })).toThrow("IDEMPOTENCY_CONFLICT");
    const request = { ...command.request, autoSecurity: true };
    expect(() => fixture.store.existing({ ...command, request, requestDigest: requestDigest(request) })).toThrow("IDEMPOTENCY_CONFLICT");
    expect(() => fixture.store.existing({ ...command, request })).toThrow("CONTROL_REQUEST_INVALID");
    expect(fixture.store.list({ limit: 100 })).toHaveLength(1);
  });

  test("queued jobs survive restart, claimed validating/staged jobs require recovery before any work", async () => {
    for (const phase of ["validating", "staged"]) {
      await using fixture = await controlFixture();
      const command = fixture.command();
      fixture.store.accept(command, fixture.release, at);
      fixture.reopen();
      expect(fixture.store.state().mode).toBe("open");
      expect(fixture.store.receipt(command.operationId)?.phase).toBe("queued");
      expect(fixture.store.claimDue(at)?.command.operationId).toBe(command.operationId);
      if (phase === "staged") fixture.store.progress(command.operationId, "staged", 0.2, at);
      fixture.reopen();
      expect(fixture.store.state().mode).toBe("recovery_required");
      expect(fixture.store.state().operationId).toBe(command.operationId);
      expect(fixture.store.receipt(command.operationId)?.phase).toBe("recovery_required");
      expect(fixture.store.receipt(command.operationId)?.operation.errorCode).toBe("CONTROLLER_INTERRUPTED");
      expect(fixture.store.claimDue(later)).toBeNull();
      expect(() => fixture.store.accept(fixture.command("another"), fixture.release, later)).toThrow("CONTROL_RECOVERY_REQUIRED");
      expect(() => fixture.store.finishUnchanged(command.operationId, "FAILED", "{}", later)).toThrow("CONTROL_INVALID_TRANSITION");
      expect(fixture.store.existing(command)?.command.operationId).toBe(command.operationId);
    }
  });

  test("closing generation survives restart; old epoch cannot write", async () => {
    await using fixture = await controlFixture();
    using old = ControlStore.open(fixture.path, "fixture-install", fixture.epoch, at);
    const command = fixture.command();
    const before = fixture.store.state();
    fixture.inhibit(command);
    expect(fixture.store.state().generation).toBe(before.generation + 1);
    fixture.reopen();
    expect(fixture.store.state().mode).toBe("recovery_required");
    expect(fixture.store.state().binding).toEqual(before.binding);
    expect(() => old.accept(fixture.command("stale"), fixture.release, at)).toThrow("CONTROL_STALE_EPOCH");
  });

  test("execution intent/start/exit and stopped-cohort evidence are durable, not stop-request acknowledgments", async () => {
    await using fixture = await controlFixture();
    const execution = {
      id: id(), installationId: "fixture-install", operationId: null,
      supervisorEpoch: fixture.epoch, generation: 0, role: "api", purpose: "ordinary",
      unit: "quire-fixture-api.service", invocationId: "exact-invocation", containerIds: ["owned-container"],
    };
    const parsed = fixture.store.executionIntent({ ...execution, purpose: "ordinary" }, at);
    expect(parsed.startedAt).toBeNull();
    expect(() => fixture.store.executionIntent({
      ...execution, id: id(), role: "unowned-role", purpose: "ordinary",
    }, at)).toThrow("CONTROL_EXECUTION_DENIED");
    fixture.store.acknowledgeExecution(execution.id, "started", at);
    const command = fixture.command();
    fixture.inhibit(command);
    expect(() => fixture.store.executionIntent({ ...execution, id: id(), purpose: "ordinary" }, at)).toThrow("CONTROL_EXECUTION_DENIED");
    expect(() => fixture.stopped(command.operationId)).toThrow("CONTROL_EXECUTIONS_UNSETTLED");
    fixture.store.acknowledgeExecution(execution.id, "exited", later, '{"code":0,"containersExited":true}');
    expect(() => fixture.store.recordStopped(command.operationId, {
      observedAt: at, inventoryDigest: hash, managerEvidenceBytes: "wrong inventory",
      executions: fixture.store.executions().map(record => record.identity),
    }, at)).toThrow("CONTROL_EXECUTIONS_UNSETTLED");
    fixture.stopped(command.operationId);
    expect(fixture.store.receipt(command.operationId)?.phase).toBe("stopped");
    fixture.reopen();
    expect(fixture.store.executions()[0]?.resultBytes).toBe('{"code":0,"containersExited":true}');
    expect(fixture.store.state().mode).toBe("recovery_required");
  });

  test("maintenance intent precedes result and cannot start before stopped evidence or backup", async () => {
    await using fixture = await controlFixture();
    const command = fixture.command();
    fixture.inhibit(command);
    const intent = {
      id: id(), operationId: command.operationId, supervisorEpoch: fixture.epoch,
      generation: fixture.store.state().generation, inputBytes: "original input bytes\n", createdAt: at,
    };
    expect(() => fixture.store.recordIntent({ ...intent, kind: "migration" })).toThrow("CONTROL_STOPPED_EVIDENCE_REQUIRED");
    fixture.stopped(command.operationId);
    expect(() => fixture.store.recordIntent({ ...intent, kind: "migration" })).toThrow("CONTROL_BACKUP_REQUIRED");
    fixture.store.recovery(command.operationId, {
      candidate: fixture.candidate, backup: { id: id(), digest: hash, path: join(fixture.root, "archive"), verifiedAt: at },
      originalMigrationLedger: '[{"id":"original","digest":"unchanged bytes"}]\n', restoreResult: null,
    }, at);
    fixture.store.recordIntent({ ...intent, kind: "migration" });
    expect(fixture.store.intent(intent.id)?.resultBytes).toBeNull();
    expect(fixture.store.receipt(command.operationId)?.recovery?.migrationIntent).toBe(intent.id);
    fixture.store.recordResult(intent.id, "failed", '{ "error": "real SQL result bytes" }\n', later);
    expect(() => fixture.store.recordResult(intent.id, "succeeded", "{}", later)).toThrow("CONTROL_INTENT_CONFLICT");
    fixture.reopen();
    expect(fixture.store.intent(intent.id)?.outcome).toBe("failed");
    expect(fixture.store.intent(intent.id)?.inputBytes).toBe(intent.inputBytes);
    expect(fixture.store.receipt(command.operationId)?.recovery?.originalMigrationLedger).toContain("unchanged bytes");
  });

  test("success receipt, floor, binding and open permission commit atomically or not at all", async () => {
    await using fixture = await controlFixture();
    const command = fixture.command();
    fixture.inhibit(command);
    fixture.stopped(command.operationId);
    const healthId = fixture.health(command.operationId);
    const commit = fixture.commitInput(command.operationId, healthId);
    const beforeState = fixture.store.state();
    const beforeReceipt = fixture.store.receipt(command.operationId);
    using injector = new Database(fixture.path, { create: false });
    injector.exec("CREATE TRIGGER fail_state BEFORE UPDATE ON installation BEGIN SELECT RAISE(ABORT,'atomic failure'); END;");
    expect(() => fixture.store.commit(commit)).toThrow("atomic failure");
    expect(fixture.store.state()).toEqual(beforeState);
    expect(fixture.store.receipt(command.operationId)).toEqual(beforeReceipt);
    injector.exec("DROP TRIGGER fail_state");
    const operation = fixture.store.commit(commit);
    expect(operation.status).toBe("succeeded");
    expect(fixture.store.state()).toEqual({
      ...beforeState, mode: "open", operationId: null,
      floor: { sequence: 2, version: "2.0.0" }, binding: fixture.candidate,
    });
    fixture.reopen();
    expect(fixture.store.state().mode).toBe("open");
    expect(fixture.store.receipt(command.operationId)?.resultBytes).toBe(commit.resultBytes);
    expect(fixture.store.existing(command)?.operation).toEqual(operation);
    expect(() => fixture.store.accept(fixture.command("downgrade"), fixture.release, later)).toThrow("RELEASE_DOWNGRADE");
  });

  test("failed rollback retains closed recovery; verified prior binding failure commit never lowers floor", async () => {
    await using fixture = await controlFixture();
    const command = fixture.command();
    fixture.inhibit(command);
    fixture.stopped(command.operationId);
    fixture.store.requireRecovery(command.operationId, "ROLLBACK_FAILED", at);
    fixture.reopen();
    expect(fixture.store.receipt(command.operationId)?.operation.errorCode).toBe("ROLLBACK_FAILED");
    // A fresh controller must record its own stopped observation and health;
    // old-epoch evidence cannot reopen the gate.
    expect(() => fixture.health(command.operationId, fixture.prior)).toThrow("CONTROL_RECOVERY_AUTHORIZATION_REQUIRED");
    fixture.store.beginRecovery(fixture.recoveryCommand(command.operationId), at);
    fixture.stopped(command.operationId);
    const health = fixture.health(command.operationId, fixture.prior);
    const commit = fixture.commitInput(command.operationId, health);
    expect(() => fixture.store.commit({ ...commit, binding: fixture.prior, outcome: "failed", errorCode: "FAILED" })).toThrow("CONTROL_COMMIT_DENIED");
    const failureCommit = {
      ...commit, binding: fixture.prior, outcome: "failed", errorCode: "MIGRATION_FAILED",
      successfulFloor: null, resultBytes: '{ "rolledBack": true }\n',
    };
    const beforeState = fixture.store.state();
    const beforeReceipt = fixture.store.receipt(command.operationId);
    using injector = new Database(fixture.path, { create: false });
    injector.exec("CREATE TRIGGER fail_rollback_commit BEFORE UPDATE ON installation BEGIN SELECT RAISE(ABORT,'failed receipt atomicity'); END;");
    expect(() => fixture.store.commit({ ...failureCommit, outcome: "failed" })).toThrow("failed receipt atomicity");
    expect(fixture.store.state()).toEqual(beforeState);
    expect(fixture.store.receipt(command.operationId)).toEqual(beforeReceipt);
    injector.exec("DROP TRIGGER fail_rollback_commit");
    fixture.store.commit({ ...failureCommit, outcome: "failed" });
    expect(fixture.store.state().mode).toBe("open");
    expect(fixture.store.state().floor).toEqual({ sequence: 1, version: "1.0.0" });
    fixture.reopen();
    expect(fixture.store.receipt(command.operationId)?.operation.status).toBe("failed");
  });

  test("list filters and exclusive descending cursor retain operation visibility", async () => {
    await using fixture = await controlFixture();
    const commands = [fixture.command("one"), fixture.command("two"), fixture.command("three")];
    for (const command of commands) fixture.store.accept(command, fixture.release, at);
    const expected = commands.map(command => command.operationId).sort().reverse();
    const first = fixture.store.list({ limit: 1 });
    expect(first[0]?.operation.id).toBe(expected[0]);
    const cursor = first[0]?.operation.id;
    if (cursor === undefined) throw new Error("Missing first receipt");
    expect(fixture.store.list({ limit: 100, cursor }).map(row => row.operation.id)).toEqual(expected.slice(1));
    expect(fixture.store.list({ limit: 100, actorId: id() })).toEqual([]);
    expect(fixture.store.list({ limit: 100, kind: "backup" })).toEqual([]);
    expect(fixture.store.list({ limit: 100, status: "succeeded" })).toEqual([]);
    expect(fixture.store.nextAt()).toBe(at);
    expect(canonicalJson(fixture.store.get(commands[0]?.operationId ?? id()))).toContain("queued");
  });

  test("helper death requires exact authenticated recovery and an old recovery command cannot be replayed", async () => {
    await using fixture = await controlFixture();
    const command = fixture.command();
    fixture.inhibit(command);
    fixture.stopped(command.operationId);
    const identity = {
      id: id(), installationId: "fixture-install", operationId: command.operationId,
      supervisorEpoch: fixture.epoch, generation: fixture.store.state().generation,
      role: "migration-helper", unit: "quire-fixture-migration.service",
      invocationId: "migration-invocation", containerIds: [],
    };
    fixture.store.executionIntent({ ...identity, purpose: "migration" }, at);
    fixture.store.acknowledgeExecution(identity.id, "started", at);
    fixture.store.acknowledgeExecution(identity.id, "exited", later);
    expect(fixture.store.state().mode).toBe("recovery_required");
    expect(fixture.store.receipt(command.operationId)?.operation.errorCode).toBe("HELPER_INTERRUPTED");
    expect(() => fixture.store.beginRecovery(fixture.recoveryCommand(id()), later)).toThrow("CONTROL_RECOVERY_DENIED");
    const recovery = fixture.recoveryCommand(command.operationId);
    const before = fixture.store.state();
    const recovered = fixture.store.beginRecovery(recovery, later);
    expect(recovered.generation).toBe(before.generation + 1);
    expect(recovered.mode).toBe("installing");
    expect(() => fixture.store.beginRecovery(recovery, later)).toThrow("CONTROL_RECOVERY_DENIED");
    fixture.reopen();
    expect(fixture.store.state().mode).toBe("recovery_required");
    expect(fixture.store.receipt(command.operationId)?.operation.errorCode).toBe("HELPER_INTERRUPTED");
  });

  test("post-migration rollback requires a recorded fresh restore and exact health binding", async () => {
    await using fixture = await controlFixture();
    const command = fixture.command();
    fixture.inhibit(command);
    fixture.stopped(command.operationId);
    const backup = { id: id(), digest: hash, path: join(fixture.root, "archive"), verifiedAt: at };
    fixture.store.recovery(command.operationId, {
      candidate: fixture.candidate, backup, originalMigrationLedger: "original migration bytes", restoreResult: null,
    }, at);
    const intentId = id();
    fixture.store.recordIntent({
      id: intentId, operationId: command.operationId,
      supervisorEpoch: fixture.epoch, generation: fixture.store.state().generation,
      kind: "migration", inputBytes: canonicalJson(fixture.candidate), createdAt: at,
    });
    const healthId = fixture.health(command.operationId, fixture.prior);
    const commit = {
      ...fixture.commitInput(command.operationId, healthId), binding: fixture.prior,
      outcome: "failed", errorCode: "MIGRATION_FAILED", successfulFloor: null,
    };
    expect(() => fixture.store.commit({ ...commit, outcome: "failed" })).toThrow("CONTROL_RESULT_MISSING");
    fixture.store.recordResult(intentId, "failed", '{"sqlError":"failed migration"}', at);
    expect(() => fixture.store.commit({ ...commit, outcome: "failed" })).toThrow("CONTROL_RESTORE_REQUIRED");
    const restored = BindingSchema.parse({
      ...fixture.prior,
      data: { dialect: "sqlite", generationId: id(), dataRoot: join(fixture.root, "data/fresh-restore") },
    });
    fixture.store.recovery(command.operationId, {
      candidate: fixture.candidate, backup, originalMigrationLedger: "original migration bytes",
      restoreResult: '{ "restoredTo": "fresh-restore" }\n',
    }, at);
    expect(() => fixture.store.commit({ ...commit, outcome: "failed", binding: restored }))
      .toThrow("CONTROL_COMMIT_DENIED");
    const restoredBinding = restored;
    const freshHealth = fixture.health(command.operationId, restoredBinding);
    fixture.store.commit({ ...commit, outcome: "failed", binding: restoredBinding, healthIntentId: freshHealth });
    expect(fixture.store.state().binding).toEqual(restoredBinding);
    expect(fixture.store.state().floor).toEqual({ sequence: 1, version: "1.0.0" });
    fixture.reopen();
    expect(fixture.store.state().mode).toBe("open");
    expect(fixture.store.receipt(command.operationId)?.operation.errorCode).toBe("MIGRATION_FAILED");
  });

  test("explicit recovery retains a missing old migration result without inventing its outcome", async () => {
    await using fixture = await controlFixture();
    const command = fixture.command();
    fixture.inhibit(command);
    fixture.stopped(command.operationId);
    const backup = { id: id(), digest: hash, path: join(fixture.root, "archive"), verifiedAt: at };
    fixture.store.recovery(command.operationId, {
      candidate: fixture.candidate, backup, originalMigrationLedger: "original ledger bytes", restoreResult: null,
    }, at);
    const migrationId = id();
    fixture.store.recordIntent({
      id: migrationId, operationId: command.operationId, supervisorEpoch: fixture.epoch,
      generation: fixture.store.state().generation, kind: "migration",
      inputBytes: canonicalJson(fixture.candidate), createdAt: at,
    });
    fixture.reopen();
    fixture.store.beginRecovery(fixture.recoveryCommand(command.operationId), later);
    fixture.stopped(command.operationId);
    const restored = BindingSchema.parse({
      ...fixture.prior, data: { dialect: "sqlite", generationId: id(), dataRoot: join(fixture.root, "data/recovered") },
    });
    fixture.store.recovery(command.operationId, {
      candidate: fixture.candidate, backup, originalMigrationLedger: "original ledger bytes",
      restoreResult: '{"freshRestore":"recorded"}',
    }, later);
    const health = fixture.health(command.operationId, restored);
    fixture.store.commit({
      ...fixture.commitInput(command.operationId, health), binding: restored,
      outcome: "failed", errorCode: "CONTROLLER_INTERRUPTED", successfulFloor: null,
    });
    expect(fixture.store.intent(migrationId)?.outcome).toBeNull();
    expect(fixture.store.intent(migrationId)?.resultBytes).toBeNull();
    expect(fixture.store.state().mode).toBe("open");
    expect(fixture.store.state().floor.sequence).toBe(1);
  });
});
