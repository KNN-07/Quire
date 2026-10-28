import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InstantSchema } from "@quire/contracts";
import { configureBackups, createBackup, inspectRestoreTarget, restoreBackup, restoreBackupToTarget,
  restoreConfirmation } from "../../../../services/operations/backups";
import type { BackupContext } from "../../../../services/operations/backups/model";
import { backupHost } from "../../../../services/operations/backups/model";
import { fixtureIds } from "../../../fixtures/foundation";
import { backupFixture } from "../../backups/fixture";
import { restoreTargetScaleFixture } from "../../backups/restore-target-scale-fixture";

const scope = { projectId: fixtureIds.project, branch: "retained-foundation-fence" };
const expiresAt = InstantSchema.parse("2099-01-01T00:00:00.000Z");

async function seedFence(source: BackupContext) {
  await source.db.run(`INSERT INTO branch_leases(project_id,branch,owner,fence,expires_at)
    VALUES(?,?,'archived-owner',41,?) ON CONFLICT(project_id,branch) DO UPDATE SET
    owner=excluded.owner,fence=excluded.fence,expires_at=excluded.expires_at`,
  [scope.projectId, scope.branch, expiresAt]);
}

async function checkFence(source: BackupContext, target: BackupContext) {
  const row = await target.db.get<{ owner: string; fence: number; expires_at: string }>(
    "SELECT owner,fence,expires_at FROM branch_leases WHERE project_id=? AND branch=?",
    [scope.projectId, scope.branch]);
  if (row === null) throw new Error("Restored branch fence is missing");
  expect({ owner: row.owner, fence: row.fence }).toEqual({ owner: "archived-owner", fence: 41 });
  expect(row.expires_at <= target.clock.now()).toBe(true);
  await rejects(target.uow.run(tx => target.branches.assert(tx, {
    scope, owner: "archived-owner", fence: 41, expiresAt,
  })), /STALE_BRANCH_FENCE/);
  const lease = await target.branches.acquire(scope, "fresh-owner", 300000);
  if (lease === null) throw new Error("Restored expired authority blocked a fresh lease");
  try {
    expect(lease.fence).toBe(42);
    await rejects(target.uow.run(tx => target.branches.assert(tx, {
      scope, owner: "archived-owner", fence: 41, expiresAt,
    })), /STALE_BRANCH_FENCE/);
  } finally {
    await target.branches.release(lease);
  }
  expect(await source.db.get("SELECT owner,fence,expires_at FROM branch_leases WHERE project_id=? AND branch=?",
    [scope.projectId, scope.branch])).toEqual({ owner: "archived-owner", fence: 41, expires_at: expiresAt });
  console.info("FOUNDATION_FENCE", JSON.stringify({
    dialect: target.db.dialect, archivedFence: 41, restoredFence: 41, freshFence: lease.fence,
    sourceOwner: "archived-owner", restoredAuthority: "expired",
  }));
}

test("fresh native import preserves a high branch fence, expires its owner and advances only the new target", async () => {
  await using fixture = await backupFixture();
  await seedFence(fixture.runtime);
  const archive = await createBackup(fixture.runtime);
  const retained = [await inspectRestoreTarget(fixture.runtime)];
  const destination = join(fixture.restoreRoot, "fence-target");
  await mkdir(destination, { mode: 0o700 });
  await writeFile(join(destination, "secret.key"), Buffer.from(fixture.runtime.secretKey).toString("hex") + "\n", { mode: 0o600 });
  const target = await backupHost(fixture.runtime).openFresh(destination, fixture.runtime.secretKey);
  try {
    await restoreBackupToTarget(fixture.runtime, {
      archive: archive.destination, target, identity: await inspectRestoreTarget(target), retained,
    });
    await checkFence(fixture.runtime, target);
  } finally {
    await target.close();
  }
}, 120000);

test("fresh PostgreSQL import preserves the actual remote branch fence and denies the restored old owner", async () => {
  await using fixture = await backupFixture();
  await using scale = await restoreTargetScaleFixture(fixture.runtime.secretKey);
  const original = await createBackup(fixture.runtime);
  const source = await scale.open("source");
  const host = backupHost(fixture.runtime);
  configureBackups(fixture.runtime, { ...host, openFresh: source.openRuntime });
  await restoreBackup(fixture.runtime, { archive: original.destination, target: "postgres-seed",
    confirmation: restoreConfirmation(original.manifest.id, "postgres-seed") });
  configureBackups(source.runtime, { ...host, configuration: source.configuration,
    exclusive: work => source.runtime.admission.exclusive(work), openFresh: source.openRuntime });
  await seedFence(source.runtime);
  const archive = await createBackup(source.runtime);
  const retained = [await inspectRestoreTarget(source.runtime)];
  const target = await scale.open("target");
  await restoreBackupToTarget(source.runtime, {
    archive: archive.destination, target: target.runtime,
    identity: await inspectRestoreTarget(target.runtime), retained,
  });
  await checkFence(source.runtime, target.runtime);
}, 300000);
