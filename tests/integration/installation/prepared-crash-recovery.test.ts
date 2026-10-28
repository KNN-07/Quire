import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { z } from "zod";
import { InstallationStateSchema } from "../../../services/operations/installation/model";
import { inspectUnit, cgroupPids } from "../../../services/operations/installation/systemd-process";
import { nativeInstallation, origin, password } from "./native-fixture";

test("controller death at actual prepared health stays closed until exact operator recovery restores fresh data", async () => {
  await using owned = await nativeInstallation({ healthBarrier: true });
  await owned.start();
  const port = owned.ports[0];
  if (!port || owned.prior.data.dialect !== "sqlite") throw new Error("Expected native API binding");
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "operator@quire.local", password }),
    signal: AbortSignal.timeout(10000),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected authenticated operator cookie");
  const me = await fetch(`http://127.0.0.1:${port}/api/me`, {
    headers: { cookie, origin }, signal: AbortSignal.timeout(10000),
  });
  const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
  // The fixture subscribes its real peer-verified Unix health channel before
  // scheduling. This is a reached lifecycle boundary, not a timer-based guess.
  const health = Promise.withResolvers<Awaited<typeof owned.preparedHealth>>();
  const deadline = setTimeout(() => health.reject(new Error("Real prepared health boundary timed out")), 120000);
  void owned.preparedHealth.then(health.resolve, health.reject);
  try {
    const accepted = await fetch(`http://127.0.0.1:${port}/api/admin/updates`, {
      method: "POST",
      headers: { cookie, origin, "x-csrf-token": csrf, "content-type": "application/json",
        "idempotency-key": "actual-controller-prepared-crash" },
      body: JSON.stringify({ releaseId: owned.release.id,
        at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false }),
      signal: AbortSignal.timeout(120000),
    });
    expect(accepted.status).toBe(202);
    const reached = await health.promise;
    expect(reached.binding.release.releaseId).toBe(owned.release.id);
    const failedSource = new Database(join(owned.prior.data.dataRoot, "quire.sqlite"), { readonly: true });
    try {
      expect(failedSource.query("SELECT value FROM installation_update_probe").all())
        .toEqual([{ value: "real-signed-migration" }]);
    } finally { failedSource.close(); }
    const beforeCrash = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
    await owned.killController();
    await owned.start();
    const status = await owned.operatorCommand("status");
    expect(status.code, status.stderr).toBe(0);
    const closed = z.object({ installation: InstallationStateSchema,
      operation: z.object({ id: z.string() }) }).parse(JSON.parse(status.stdout));
    expect(closed.installation.mode).toBe("recovery_required");
    expect(closed.installation.supervisorEpoch).not.toBe(beforeCrash.supervisorEpoch);
    const operationId = closed.installation.operationId;
    if (!operationId) throw new Error("Expected durable interrupted operation");
    expect(closed.operation.id).toBe(operationId);
    for (const role of owned.config.roles) {
      const unit = await inspectUnit(owned.config, role.unit);
      expect(["inactive", "failed"]).toContain(unit.state);
      if (unit.cgroup) expect(await cgroupPids(unit.cgroup)).toEqual([]);
    }
    const wrong = await owned.operatorCommand("recover", {
      installationId: owned.config.installationId, operationId: crypto.randomUUID(),
    });
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toContain("CONTROL_RECOVERY_DENIED");
    expect(InstallationStateSchema.parse(await owned.control({ method: "status", input: {} })).mode)
      .toBe("recovery_required");
    const active = owned.activatedAfter(closed.installation.generation);
    const recovered = await owned.operatorCommand("recover", {
      installationId: owned.config.installationId, operationId,
    });
    expect(recovered.code, recovered.stderr).toBe(0);
    await active;
    const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
    expect(state.mode).toBe("open");
    expect(state.floor).toEqual({ sequence: 1, version: "1.0.0" });
    expect(state.binding.release).toEqual(owned.prior.release);
    expect(state.binding.data.generationId).not.toBe(owned.prior.data.generationId);
    if (state.binding.data.dialect !== "sqlite") throw new Error("Expected fresh native recovery");
    const restored = new Database(join(state.binding.data.dataRoot, "quire.sqlite"), { readonly: true });
    try {
      expect(restored.query("SELECT name FROM sqlite_master WHERE name='installation_update_probe'").all()).toEqual([]);
    } finally { restored.close(); }
    console.info("INSTALLATION_PREPARED_CRASH_RECOVERY", JSON.stringify({ reached, beforeCrash, closed, state }));
  } finally { clearTimeout(deadline); }
}, 240000);
