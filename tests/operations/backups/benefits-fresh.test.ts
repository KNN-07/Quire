import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { join } from "node:path";
import { createLocalAdapters, loadConfig } from "@quire/runtime";
import { createBackup, configureBackups, restoreBackup, restoreConfirmation } from "../../../services/operations/backups";
import { backupHost } from "../../../services/operations/backups/model";
import { backupFixture } from "./fixture";

const benefitRows = "SELECT * FROM account_project_benefits ORDER BY scope_kind,scope_id";

test("restores configured project benefits over exact fresh migration defaults", async () => {
  await using fixture = await backupFixture();
  await fixture.runtime.db.run(`UPDATE account_project_benefits SET benefits_json=?,version=3,updated_at=?
    WHERE scope_kind='deployment' AND scope_id='local'`,
  ['{"compileSeconds":60,"writableMembers":2,"historyDays":30,"trackChanges":false}', fixture.runtime.clock.now()]);
  await fixture.runtime.db.run(`INSERT INTO account_project_benefits VALUES('plan','fixture:paid',?,2,?)`,
    ['{"compileSeconds":120,"writableMembers":5,"historyDays":90,"trackChanges":true}', fixture.runtime.clock.now()]);
  const expected = await fixture.runtime.db.all(benefitRows);
  const archive = await createBackup(fixture.runtime);
  const result = await restoreBackup(fixture.runtime, { archive: archive.destination, target: "benefits",
    confirmation: restoreConfirmation(archive.manifest.id, "benefits") });
  const restored = await createLocalAdapters(loadConfig({ QUIRE_DATA_DIR: result.destination }), fixture.runtime.clock);
  try {
    expect(await restored.db.all(benefitRows)).toEqual(expected);
  } finally { await restored.close(); }
}, 120000);

const mutations = [
  { name: "changed benefit payload", sql: `UPDATE account_project_benefits SET benefits_json='{}'` },
  { name: "incremented version", sql: "UPDATE account_project_benefits SET version=1" },
  { name: "changed timestamp", sql: `UPDATE account_project_benefits SET updated_at='2026-10-27T00:00:00.000Z'` },
  { name: "different scope kind", sql: `UPDATE account_project_benefits SET scope_kind='user'` },
  { name: "different scope identity", sql: `UPDATE account_project_benefits SET scope_kind='plan',scope_id='fixture:paid'` },
  { name: "extra user grant", sql: `INSERT INTO account_project_benefits
    SELECT 'user','fixture-user',benefits_json,version,updated_at FROM account_project_benefits` },
  { name: "extra plan grant", sql: `INSERT INTO account_project_benefits
    SELECT 'plan','fixture:paid',benefits_json,version,updated_at FROM account_project_benefits` },
  { name: "withdrawn user grant", sql: `INSERT INTO account_project_benefits
    SELECT 'user','fixture-user',NULL,version,updated_at FROM account_project_benefits` },
  { name: "withdrawn plan grant", sql: `INSERT INTO account_project_benefits
    SELECT 'plan','fixture:paid',NULL,version,updated_at FROM account_project_benefits` },
] as const;

test.each(mutations)("rejects and preserves existing project benefits: $name", async ({ sql }) => {
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  const host = backupHost(fixture.runtime);
  let expected: readonly Record<string, unknown>[] = [];
  configureBackups(fixture.runtime, { ...host, openFresh: async (target, key) => {
    const runtime = await host.openFresh(target, key);
    await runtime.db.run(sql);
    expected = await runtime.db.all(benefitRows);
    return runtime;
  } });
  await rejects(restoreBackup(fixture.runtime, { archive: archive.destination, target: "survivor-benefits",
    confirmation: restoreConfirmation(archive.manifest.id, "survivor-benefits") }),
  { code: "RESTORE_TARGET_NOT_EMPTY", message: "account_project_benefits" });
  const restored = await createLocalAdapters(
    loadConfig({ QUIRE_DATA_DIR: join(fixture.restoreRoot, "survivor-benefits") }), fixture.runtime.clock);
  try {
    expect(await restored.db.all(benefitRows)).toEqual(expected);
    expect(await restored.db.get("SELECT 1 FROM users LIMIT 1")).toBeNull();
  } finally { await restored.close(); }
}, 120000);
