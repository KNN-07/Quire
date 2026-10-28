import { test, expect } from "bun:test";
import { z } from "zod";
import { rejects } from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scheduleSlot, putPolicy, retainBackups } from "../../../services/operations/backups/policy";
import { runScheduledBackup } from "../../../services/operations/backups";
import { fixtureIds } from "../../fixtures/foundation";
import { backupFixture } from "./fixture";

test("selects exact UTC schedule slots across midnight rather than wall-clock polling", () => {
  // Given a daily 01:15 UTC schedule.
  const schedule = "15 1 * * *";
  // When the current injected clock is just before the next slot.
  const slot = scheduleSlot(schedule, "2026-10-27T01:14:59.999Z");
  // Then the last due day is selected exactly.
  expect(slot).toBe("2026-10-26T01:15:00.000Z");
});

test("deduplicates a scheduled slot and removes only owned verified expired records", async () => {
  // Given a real backup policy and an unrelated directory in the same root.
  await using fixture = await backupFixture();
  await putPolicy(fixture.context, {
    schedule: "0 6 * * *", retentionDays: 1, destination: fixture.backupRoot, expectedVersion: 0,
  });
  const survivor = join(fixture.backupRoot, "not-a-recorded-backup");
  await mkdir(survivor);
  await writeFile(join(survivor, "data"), "keep");
  // When the role scheduler runs twice in the same due slot and retention runs later.
  const first = await runScheduledBackup(fixture.context, fixtureIds.operator);
  const second = await runScheduledBackup(fixture.context, fixtureIds.operator);
  fixture.setTime("2026-10-29T07:00:00.000Z");
  const removed = await retainBackups(fixture.context);
  // Then one real backup is recorded and only its verified expired archive is removed.
  expect(second?.id).toBe(first?.id);
  expect(await fixture.runtime.db.all("SELECT id FROM backups")).toHaveLength(1);
  expect(removed).toEqual([z.string().parse(first?.result?.["backupId"])]);
  expect(await readFile(join(survivor, "data"), "utf8")).toBe("keep");
}, 120000);

test("rejects a retention value that cannot be read back as a valid policy", async () => {
  // Given the same private destination and policy version used by a valid update.
  await using fixture = await backupFixture();
  // When a value exceeds the policy schema's supported range.
  const changed = putPolicy(fixture.context, { schedule: "disabled", retentionDays: 36501,
    destination: fixture.backupRoot, expectedVersion: 0 });
  // Then the invalid policy is rejected before storage.
  await rejects(changed, z.ZodError);
}, 120000);
