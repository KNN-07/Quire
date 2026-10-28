import { expect, test } from "bun:test";
import { readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./fixture";
import { rejection } from "./rejection";

for (const change of [
  { sequence: 1 }, { version: "0.9.0" }, { compatibleSchema: [99] },
  { expiresAt: "2026-10-26T00:00:00.000Z" },
] as const) {
  test(`rejects ineligible signed release ${JSON.stringify(change)} before scheduling`, async () => {
    // Given
    await using f = await fixture();
    f.alterManifest(change);
    // When / Then
    expect(await rejection(f.schedule())).toBeInstanceOf(Error);
    expect(await readlink(join(f.config.installRoot, "current"))).toBe("releases/prior");
  });
}

test("rejects non-security releases when security-only scheduling is selected", async () => {
  // Given
  await using f = await fixture();
  f.alterManifest({ security: false });
  // When / Then
  expect(await rejection(f.schedule({ autoSecurity: true }))).toMatchObject({ code: "SECURITY_RELEASE_REQUIRED" });
});

test("rejects an arbitrary package origin even when its manifest is signed", async () => {
  // Given
  await using f = await fixture();
  f.alterManifest({ packageUrl: "https://unconfigured.invalid/package" });
  // When / Then
  expect(await rejection(f.schedule())).toMatchObject({ code: "RELEASE_ORIGIN_MISMATCH" });
});

test("rejects traversal in a digest-valid signed package before writing outside the release directory", async () => {
  // Given
  await using f = await fixture();
  f.unsafePackage();
  const queued = await f.schedule();
  // When
  await f.service.tick();
  // Then
  expect((await f.service.store.operation(queued.id)).status).toBe("failed");
  expect(await readlink(join(f.config.installRoot, "current"))).toBe("releases/prior");
  expect(await Bun.file(join(f.config.installRoot, "escape")).exists()).toBe(false);
});

test("rejects a schedule outside the explicit maintenance window", async () => {
  // Given
  await using f = await fixture();
  // When / Then
  expect(await rejection(f.schedule({ at: "2026-10-27T11:00:00.000Z" }))).toMatchObject({ code: "OUTSIDE_MAINTENANCE_WINDOW" });
});

test("fails an overdue job rather than installing after maintenance closes", async () => {
  // Given
  await using f = await fixture();
  const queued = await f.schedule();
  f.advance("2026-10-27T11:00:00.000Z");
  // When
  await f.service.tick();
  // Then
  expect((await f.service.store.operation(queued.id)).errorCode).toBe("OUTSIDE_MAINTENANCE_WINDOW");
  expect(await readlink(join(f.config.installRoot, "current"))).toBe("releases/prior");
});

for (const failure of ["backup", "preflight"] as const) {
  test(`preserves data and the current version when the ${failure} prerequisite fails`, async () => {
    // Given
    await using f = await fixture();
    const queued = await f.schedule();
    if (failure === "backup") f.failBackup(); else f.failPreflight();
    // When
    await f.service.tick();
    // Then
    expect((await f.service.store.operation(queued.id)).status).toBe("failed");
    expect(f.migrated()).toBeNull();
    expect(f.document()).toEqual({ body: "retained source" });
    expect(await readlink(join(f.config.installRoot, "current"))).toBe("releases/prior");
    expect(f.isHeld()).toBe(false);
  });
}

test("revalidates the signed manifest at execution rather than trusting a stale queue entry", async () => {
  // Given
  await using f = await fixture();
  const queued = await f.schedule();
  f.alterManifest({ notes: "withdrawn original, replaced manifest" });
  // When
  await f.service.tick();
  // Then
  expect((await f.service.store.operation(queued.id)).errorCode).toBe("RELEASE_CHANGED_OR_WITHDRAWN");
  expect(f.migrated()).toBeNull();
});

test("rejects a replay after process restart by reading the durable installed sequence", async () => {
  // Given
  await using f = await fixture();
  await f.schedule();
  await f.service.tick();
  await f.reopenControl();
  // When / Then
  expect(await rejection(f.schedule())).toMatchObject({ code: "REPLAY_OR_DOWNGRADE" });
});

test("returns the original receipt when a completed request is retried with the same idempotency key", async () => {
  // Given
  await using f = await fixture();
  const queued = await f.schedule({ key: "same-request" });
  await f.service.tick();
  f.rejectFeed();
  // When
  const replay = await f.schedule({ key: "same-request" });
  // Then
  expect(replay.id).toBe(queued.id);
  expect(replay.status).toBe("succeeded");
});

test("rejects changed intent when an idempotency key is reused", async () => {
  // Given
  await using f = await fixture();
  await f.schedule({ key: "same-request" });
  // When / Then
  expect(await rejection(f.schedule({ key: "same-request", autoSecurity: true }))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});

test("rejects installation into an unmarked directory", async () => {
  // Given
  await using f = await fixture();
  await writeFile(join(f.config.installRoot, ".quire-update-root"), "somebody-elses-install");
  // When / Then
  expect(await rejection(f.schedule())).toMatchObject({ code: "INSTALL_ROOT_NOT_OWNED" });
});

test("rejects a current symlink escaping the owned release prefix", async () => {
  // Given
  await using f = await fixture();
  await unlink(join(f.config.installRoot, "current"));
  await symlink("/usr/bin", join(f.config.installRoot, "current"));
  // When / Then
  expect(await rejection(f.schedule())).toMatchObject({ code: "UNSAFE_CURRENT_TARGET" });
});
