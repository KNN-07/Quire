import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { IdSchema } from "@quire/contracts";
import { createLocalAdapters, loadConfig } from "@quire/runtime";
import { performJob } from "../../../services/operations/backups/jobs";
import { backupRecord } from "../../../services/operations/backups/jobs";
import { restoreBackup, restoreConfirmation } from "../../../services/operations/backups";
import { backupHost, configureBackups } from "../../../services/operations/backups/model";
import { fixtureIds } from "../../fixtures/foundation";
import { bounded } from "../../integration/portable/process";
import { backupFixture } from "./fixture";

test("claims one durable backup operation when simultaneous requests share an idempotency key", async () => {
  // Given two independent requests for the same operator action.
  await using fixture = await backupFixture();
  const input = { key: crypto.randomUUID(), action: "create" } as const;
  const admitted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const host = backupHost(fixture.runtime);
  configureBackups(fixture.runtime, { ...host, exclusive: async work => {
    admitted.resolve();
    await release.promise;
    return host.exclusive(work);
  } });
  // When a duplicate arrives after durable claim but before the original snapshot completes.
  const first = performJob(fixture.context, fixtureIds.operator, input);
  let second: Awaited<ReturnType<typeof performJob>>;
  try {
    await bounded(Promise.race([admitted.promise, first.then(() => undefined)]), 10000);
    second = await performJob(fixture.context, fixtureIds.operator, input);
  }
  finally { release.resolve(); }
  const results = [await first, second];
  // Then both identify one real operation and exactly one archive is recorded.
  expect(new Set(results.map(result => result.id)).size).toBe(1);
  expect(await fixture.runtime.db.all("SELECT id FROM backups")).toHaveLength(1);
}, 120000);

test("rechecks operator authority after draining an already admitted writer", async () => {
  // Given an admitted authority revocation waiting for an exact release signal.
  await using fixture = await backupFixture();
  const release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const host = backupHost(fixture.runtime);
  configureBackups(fixture.runtime, { ...host, exclusive: work => {
    entered.resolve();
    return fixture.gate.exclusive(work);
  } });
  const revocation = fixture.gate.writer(async () => {
    await release.promise;
    await fixture.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [fixtureIds.operator]);
  });
  // When backup admission must wait for that revocation to finish.
  const operation = performJob(fixture.context, fixtureIds.operator, { action: "create", key: crypto.randomUUID() });
  const denied = rejects(operation, { code: "FORBIDDEN" });
  try { await bounded(Promise.race([entered.promise, denied]), 10000); }
  finally { release.resolve(); await revocation; }
  // Then the completed revocation denies the snapshot under exclusive admission.
  await denied;
  expect(await fixture.runtime.db.get<{ status: string }>("SELECT status FROM backups")).toEqual({ status: "failed" });
}, 120000);

test("recovers the archived in-flight backup receipt without changing completed source authority", async () => {
  // Given a finished backup whose consistent snapshot captured its own operation in flight.
  await using fixture = await backupFixture();
  const operation = await performJob(fixture.context, fixtureIds.operator, { action: "create", key: crypto.randomUUID() });
  const record = await backupRecord(fixture.context, IdSchema.parse(operation.result?.["backupId"]));
  // When that archive is restored into a fresh isolated target.
  const restored = await restoreBackup(fixture.runtime, { archive: record.destination, target: "receipt-recovery",
    confirmation: restoreConfirmation(record.id, "receipt-recovery") });
  const target = await createLocalAdapters(loadConfig({ QUIRE_DATA_DIR: restored.destination }), fixture.runtime.clock);
  try {
    // Then only the target's interrupted operation is terminal, with its original ID recorded.
    expect(await target.db.get<{ status: string; error_code: string }>("SELECT status,error_code FROM operations WHERE id=?", [operation.id]))
      .toEqual({ status: "failed", error_code: "RESTORE_INTERRUPTED_BACKUP" });
    expect(restored.receipt.interruptedBackupOperations).toEqual([operation.id]);
    expect(await fixture.runtime.db.get<{ status: string }>("SELECT status FROM operations WHERE id=?", [operation.id])).toEqual({ status: "succeeded" });
  } finally { await target.close(); }
}, 120000);

test("rejects changed action under an existing idempotency key", async () => {
  // Given an operator's completed create request.
  await using fixture = await backupFixture();
  const key = crypto.randomUUID();
  const created = await performJob(fixture.context, fixtureIds.operator, { key, action: "create" });
  // When the same key is reused for verification instead.
  const changed = performJob(fixture.context, fixtureIds.operator, {
    key, action: "verify", backupId: IdSchema.parse(created.result?.["backupId"]),
  });
  // Then it fails explicitly rather than replaying the wrong action.
  await rejects(changed, { code: "IDEMPOTENCY_CONFLICT" });
}, 120000);
