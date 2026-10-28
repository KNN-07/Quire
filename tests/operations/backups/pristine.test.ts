import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { join } from "node:path";
import { createLocalAdapters, loadConfig } from "@quire/runtime";
import { IdSchema } from "@quire/contracts";
import { createBackup, configureBackups, restoreBackup, restoreConfirmation } from "../../../services/operations/backups";
import { backupHost } from "../../../services/operations/backups/model";
import { backupFixture } from "./fixture";

test("restores operator worker policy over untouched migration-seeded defaults", async () => {
  // Given a real configured source and a fresh target factory with migration defaults.
  await using fixture = await backupFixture();
  await fixture.runtime.db.run("UPDATE o_worker_policy SET maximum=7,version=1 WHERE id=1");
  const archive = await createBackup(fixture.runtime);
  // When the full backup is restored.
  const result = await restoreBackup(fixture.runtime, { archive: archive.destination, target: "configured-policy",
    confirmation: restoreConfirmation(archive.manifest.id, "configured-policy") });
  const restored = await createLocalAdapters(loadConfig({ QUIRE_DATA_DIR: result.destination }), fixture.runtime.clock);
  try {
    // Then the source's policy survives rather than being replaced with target defaults.
    expect(await restored.db.get<{ maximum: number; version: number }>("SELECT maximum,version FROM o_worker_policy WHERE id=1"))
      .toEqual({ maximum: 7, version: 1 });
  } finally { await restored.close(); }
}, 120000);

test("expires source worker authority while preserving controller fence history and source records", async () => {
  // Given stored execution receipts naming this owned test process, not a launched worker.
  await using fixture = await backupFixture();
  const worker = IdSchema.parse(crypto.randomUUID());
  await fixture.runtime.db.run("INSERT INTO o_worker_controller(id,owner,expires_at,generation) VALUES(1,'source-owner',?,41)",
    ["2099-01-01T00:00:00.000Z"]);
  await fixture.runtime.db.run(`INSERT INTO workers(id,pool_id,state,environment_ids_json,last_heartbeat,builds_today)
    VALUES(?,'source-pool','idle','[]',?,7)`, [worker, fixture.runtime.clock.now()]);
  await fixture.runtime.db.run(`INSERT INTO o_worker_processes(id,pool_id,owner,desired,pid,started_at)
    VALUES(?,'source-pool','source-owner','running',?,?)`, [worker, process.pid, fixture.runtime.clock.now()]);
  const archive = await createBackup(fixture.runtime);
  // When recovery creates an isolated instance without adopting the source's process handles.
  const result = await restoreBackup(fixture.runtime, { archive: archive.destination, target: "worker-authority",
    confirmation: restoreConfirmation(archive.manifest.id, "worker-authority") });
  const target = await createLocalAdapters(loadConfig({ QUIRE_DATA_DIR: result.destination }), fixture.runtime.clock);
  try {
    // Then only execution authority expires; IDs, accounting and fence history survive.
    expect(await target.db.get<{ generation: number; expires_at: string }>("SELECT generation,expires_at FROM o_worker_controller"))
      .toEqual({ generation: 41, expires_at: fixture.runtime.clock.now() });
    expect(await target.db.get<{ id: string; state: string; builds_today: number }>("SELECT id,state,builds_today FROM workers"))
      .toEqual({ id: worker, state: "offline", builds_today: 7 });
    expect(await target.db.get<{ pid: number | null; desired: string }>("SELECT pid,desired FROM o_worker_processes"))
      .toEqual({ pid: null, desired: "stopped" });
    expect(result.receipt.expiredWorkerIds).toEqual([worker]);
    expect(await fixture.runtime.db.get<{ pid: number }>("SELECT pid FROM o_worker_processes")).toEqual({ pid: process.pid });
  } finally { await target.close(); }
}, 120000);

test("preserves existing operator settings when a target factory returns a configured database", async () => {
  // Given a factory that violates the fresh-storage contract by configuring its target.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  const host = backupHost(fixture.runtime);
  configureBackups(fixture.runtime, { ...host, openFresh: async (target, key) => {
    const runtime = await host.openFresh(target, key);
    await runtime.db.run("UPDATE o_worker_policy SET maximum=9,version=1 WHERE id=1");
    return runtime;
  } });
  // When restore encounters those existing settings.
  await rejects(restoreBackup(fixture.runtime, { archive: archive.destination, target: "survivor-policy",
    confirmation: restoreConfirmation(archive.manifest.id, "survivor-policy") }), { code: "RESTORE_TARGET_NOT_EMPTY" });
  const target = await createLocalAdapters(loadConfig({ QUIRE_DATA_DIR: join(fixture.restoreRoot, "survivor-policy") }), fixture.runtime.clock);
  try {
    // Then no existing configuration is overwritten, even though the target had no user rows.
    expect(await target.db.get<{ maximum: number; version: number }>("SELECT maximum,version FROM o_worker_policy WHERE id=1"))
      .toEqual({ maximum: 9, version: 1 });
  } finally { await target.close(); }
}, 120000);
