import { expect, test } from "bun:test";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ControlStore } from "../../../services/operations/installation/control-store";
import { AuthenticatedControlCommand, signControlCommand } from "../../../services/operations/installation/protocol";
import { ReportedUpdateFailure, UpdateError, UpdateService } from "../../../services/operations/updates";
import { digest } from "../../../services/operations/updates/model";
import { fixture, id } from "./fixture";
import { rejection } from "./rejection";

test("control backup intent and closed generation precede migration without any application update mirror", async () => {
  await using f = await fixture();
  const barrier = f.pauseBackup();
  const operation = await f.schedule();
  const run = f.service.tick();
  try {
    await Promise.race([barrier.ready, run.then(() => { throw new Error("Updater finished before the subscribed backup boundary"); })]);
    expect(f.control.state().mode).toBe("installing");
    expect(f.control.receipt(operation.id)?.phase).toBe("stopped");
    expect(f.control.intents(operation.id).find(intent => intent.kind === "backup")?.outcome).toBeNull();
    expect(f.control.intents(operation.id).find(intent => intent.kind === "migration")).toBeUndefined();
    expect(f.migrated()).toBeNull();
    expect(await f.runtime.db.all("SELECT * FROM operations WHERE kind='update'")).toEqual([]);
  } finally { barrier.resume(); }
  await run;
  expect(f.control.state().mode).toBe("open");
  expect(f.control.receipt(operation.id)?.operation.status).toBe("succeeded");
  expect(f.control.receipt(operation.id)?.recovery?.candidate?.release.entrypoint).toBe("bin/quire");
});

test("a rejected helper without an exited result preserves a missing intent across restart and explicit recovery", async () => {
  await using f = await fixture();
  const operation = await f.schedule();
  f.interruptMigration();
  expect(await rejection(f.service.tick())).toMatchObject({ code: "HELPER_INTERRUPTED" });
  const migration = f.control.intents(operation.id).find(intent => intent.kind === "migration");
  if (migration === undefined) throw new Error("Migration intent missing");
  expect(migration.outcome).toBeNull();
  expect(migration.resultBytes).toBeNull();
  expect(f.control.state().mode).toBe("recovery_required");
  expect(existsSync(join(f.config.installRoot, ".update-lock"))).toBe(true);
  await f.reopenControl();
  expect(f.control.state().mode).toBe("recovery_required");
  expect(f.control.intent(migration.id)?.resultBytes).toBeNull();
  expect(await f.service.nextAt()).toBeNull();
  const recovered = await f.service.recover(f.recoveryCommand(operation.id));
  expect(recovered.status).toBe("failed");
  expect(f.control.state().mode).toBe("open");
  expect(f.control.state().binding.data.generationId).not.toBe(
    f.control.receipt(operation.id)?.recovery?.prior.data.generationId,
  );
  expect(f.control.intent(migration.id)?.resultBytes).toBeNull();
  expect(f.control.state().floor.sequence).toBe(1);
  expect(existsSync(join(f.config.installRoot, ".update-lock"))).toBe(false);
});

test("execution rechecks the scheduling actor before any stop or migration", async () => {
  await using f = await fixture();
  const operation = await f.schedule();
  await f.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [f.actorId]);
  await f.service.tick();
  expect(f.control.receipt(operation.id)?.operation.errorCode).toBe("FORBIDDEN");
  expect(f.control.state().mode).toBe("open");
  expect(f.control.intents(operation.id)).toEqual([]);
  expect(f.migrated()).toBeNull();
});

test("API signing cannot become an operator recovery channel and rejects tampered command bodies", async () => {
  await using f = await fixture();
  const command = await f.reserve();
  const envelope = signControlCommand({
    protocolVersion: 1, installationId: f.config.installId, credentialId: f.credential.id,
    requestId: id(), issuedAt: f.clock.now(), command: { method: "submit", input: command },
  }, f.credential);
  expect(() => AuthenticatedControlCommand.authenticate({
    ...envelope, command: { ...envelope.command, input: { ...command, actorId: id() } },
  }, f.credential, f.clock.now())).toThrow("CONTROL_UNAUTHENTICATED");
  const recovery = signControlCommand({
    protocolVersion: 1, installationId: f.config.installId, credentialId: f.credential.id,
    requestId: id(), issuedAt: f.clock.now(), command: { method: "recover", input: {
      installationId: f.config.installId, operationId: command.operationId, generation: 0,
      supervisorEpoch: f.control.state().supervisorEpoch,
    } },
  }, f.credential);
  expect(() => AuthenticatedControlCommand.authenticate(recovery, f.credential, f.clock.now())).toThrow("CONTROL_FORBIDDEN");
});

test("a service constructed against a different independent installation is rejected", async () => {
  await using f = await fixture();
  expect(() => new UpdateService({ ...f.options, config: { ...f.config, installId: "another-install" } })).toThrow("INSTALLATION_MISMATCH");
  expect(() => ControlStore.open(join(f.root, "missing.sqlite"), f.config.installId, id(), f.clock.now())).toThrow("CONTROL_AUTHORITY_UNAVAILABLE");
  expect(existsSync(join(f.root, "missing.sqlite"))).toBe(false);
});

for (const code of ["UPDATES_DEPLOYMENT_UNSUPPORTED", "UPDATES_RESTORE_UNAVAILABLE"]) {
  test(`rejects scheduling before feed or execution when the driver reports ${code}`, async () => {
    await using f = await fixture();
    const service = new UpdateService({
      ...f.options, authority: { ...f.authority, capabilities: () => Promise.reject(new UpdateError(code)) },
    });
    try {
      expect(await rejection(service.create(await f.reserve()))).toMatchObject({ code });
      expect(f.feedRequests()).toBe(0);
      expect(f.control.list({ limit: 100 })).toEqual([]);
      expect(f.control.state().mode).toBe("open");
    } finally { await service.close(); }
  });
}

test("a claimed completed failure without a matching durable execution exit cannot trigger rollback", async () => {
  await using f = await fixture();
  const service = new UpdateService({
    ...f.options,
    storage: {
      ...f.storage,
      preflight: input => Promise.reject(new ReportedUpdateFailure("PREFLIGHT_FAILED", {
        execution: {
          id: id(), installationId: f.config.installId, operationId: input.stopped.operationId,
          supervisorEpoch: input.stopped.supervisorEpoch, generation: input.stopped.generation,
          role: "unrecorded-helper", purpose: "preflight", unit: "unrecorded.service",
          invocationId: crypto.randomUUID(), containerIds: [],
        },
        resultBytes: '{"failure":"unproven"}', migrationDigests: [digest("unproven")],
      })),
    },
  });
  try {
    const operation = await service.create(await f.reserve());
    expect(await rejection(service.tick())).toMatchObject({ code: "UPDATE_HELPER_RESULT_UNPROVEN" });
    expect(f.control.state().mode).toBe("recovery_required");
    expect(f.control.intents(operation.id).find(intent => intent.kind === "preflight")?.resultBytes).toBeNull();
    expect(f.control.intents(operation.id).some(intent => intent.kind === "restore")).toBe(false);
  } finally { await service.close(); }
});
