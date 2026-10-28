import { expect, test } from "bun:test";
import { InstantSchema } from "@quire/contracts";
import { readlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, ControlledTimer, id } from "./fixture";
import { startScheduler, UpdateError } from "../../../services/operations/updates";
import { rejection } from "./rejection";

test("installs a verified executable when the signed release passes real package and backup validation", async () => {
  // Given
  await using f = await fixture();
  const releases = await f.service.releases();
  // When
  const queued = await f.schedule();
  await f.service.tick();
  // Then
  const operation = await f.service.store.operation(queued.id);
  expect(releases).toHaveLength(1);
  expect(releases[0]?.signatureVerified).toBe(true);
  expect(operation.status).toBe("succeeded");
  expect(operation.result?.["version"]).toBe("2.0.0");
  expect(await readlink(join(f.config.installRoot, "current"))).toContain("releases/2-");
  expect(await readFile(join(f.config.installRoot, "releases", "prior", "quire"), "utf8")).toContain("1.0.0");
  expect(f.migrated()).not.toBeNull();
  expect(f.isHeld()).toBe(false);
});

test("rejects feed discovery when its signature is tampered", async () => {
  // Given
  await using f = await fixture();
  f.corruptSignature();
  // When / Then
  expect(await rejection(f.service.releases())).toMatchObject({ code: "SIGNATURE_INVALID" });
});

test("retains the prior executable when the package digest is tampered", async () => {
  // Given
  await using f = await fixture();
  const operation = await f.schedule();
  f.corruptPackage();
  // When
  await f.service.tick();
  // Then
  expect((await f.service.store.operation(operation.id)).errorCode).toBe("PACKAGE_DIGEST_MISMATCH");
  expect(await readlink(join(f.config.installRoot, "current"))).toBe("releases/prior");
  expect(f.migrated()).toBeNull();
});

test("fires a security-only scheduled update when the controlled clock reaches its subscribed deadline", async () => {
  // Given: the subscription is armed before advancing the clock.
  await using f = await fixture();
  const operation = await f.schedule({ at: "2026-10-27T10:10:00.000Z", autoSecurity: true });
  const timer = new ControlledTimer();
  const errors: unknown[] = [];
  const scheduler = startScheduler(f.service, (error) => errors.push(error), timer);
  await timer.ready;
  expect((await f.service.releases())[0]?.scheduledAt).toBe(InstantSchema.parse("2026-10-27T10:10:00.000Z"));
  expect((await f.service.store.operation(operation.id)).status).toBe("queued");
  f.advance("2026-10-27T10:10:00.000Z");
  // When
  await timer.advance(f.clock.now());
  // Then
  expect((await f.service.store.operation(operation.id)).status).toBe("succeeded");
  expect(errors).toEqual([]);
  await scheduler.close();
});

for (const failure of ["migration", "healthcheck"] as const) {
  test(`restores real SQLite state and retains the prior executable when ${failure} fails`, async () => {
    // Given
    await using f = await fixture();
    const operation = await f.schedule();
    if (failure === "migration") f.failMigration(); else f.failHealthcheck();
    // When
    await f.service.tick();
    // Then
    const result = await f.service.store.operation(operation.id);
    expect(result.status).toBe("failed");
    expect(result.result?.["rolledBack"]).toBe(true);
    expect(f.migrated()).toBeNull();
    expect(f.document()).toEqual({ body: "retained source" });
    expect(await readlink(join(f.config.installRoot, "current"))).toBe("releases/prior");
    expect(f.isHeld()).toBe(false);
  });
}

test("retains durable ledger closure until an authenticated exact recovery when rollback fails", async () => {
  // Given
  await using f = await fixture();
  const operation = await f.schedule();
  f.failMigration(); f.failRollback(true);
  // When
  expect(await rejection(f.service.tick())).toBeInstanceOf(UpdateError);
  // Then
  expect(f.isHeld()).toBe(true);
  expect((await f.service.store.operation(operation.id)).errorCode).toBe("ROLLBACK_FAILED");
  expect(await rejection(f.service.recover(f.recoveryCommand(id())))).toMatchObject({ code: "CONTROL_RECOVERY_DENIED" });
  f.failRollback(false);
  const recovered = await f.service.recover(f.recoveryCommand(operation.id));
  expect(recovered.status).toBe("failed");
  expect(recovered.errorCode).toBe("INTERRUPTED_UPDATE");
  expect(f.migrated()).toBeNull();
  expect(f.isHeld()).toBe(false);
});
