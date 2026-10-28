import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { z } from "zod";
import { InstallationStateSchema } from "../../../services/operations/installation/model";
import { inspectUnit } from "../../../services/operations/installation/systemd-process";
import { nativeInstallation, origin, password } from "./native-fixture";

test("real prepared listener collision drains the candidate cohort and restores a fresh prior generation", async () => {
  await using owned = await nativeInstallation({ candidatePortConflict: true });
  await owned.start();
  const port = owned.ports[0];
  if (!port || owned.prior.data.dialect !== "sqlite") throw new Error("Expected native API binding");
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "operator@quire.local", password }),
    signal: AbortSignal.timeout(10000),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected authenticated operator cookie");
  const me = await fetch(`http://127.0.0.1:${port}/api/me`, {
    headers: { cookie, origin }, signal: AbortSignal.timeout(10000),
  });
  const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
  const before = await Promise.all(owned.config.roles.map(role => inspectUnit(owned.config, role.unit)));
  const active = owned.activatedAfter(0);
  const completed = owned.receiptWhen(row => ["succeeded", "failed"].includes(row.operation.status));
  void completed.catch(() => undefined);
  const accepted = await fetch(`http://127.0.0.1:${port}/api/admin/updates`, {
    method: "POST",
    headers: { cookie, origin, "x-csrf-token": csrf, "content-type": "application/json",
      "idempotency-key": "actual-prepared-listener-collision" },
    body: JSON.stringify({ releaseId: owned.release.id,
      at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false }),
    signal: AbortSignal.timeout(120000),
  });
  expect(accepted.status).toBe(202);
  const receipt = await completed;
  expect(receipt.operation.status, JSON.stringify(receipt.operation)).toBe("failed");
  expect(receipt.operation.result).toMatchObject({ rolledBack: true });
  await active;
  const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
  expect(state.mode).toBe("open");
  expect(state.floor).toEqual({ sequence: 1, version: "1.0.0" });
  expect(state.binding.release).toEqual(owned.prior.release);
  expect(state.binding.data.generationId).not.toBe(owned.prior.data.generationId);
  if (state.binding.data.dialect !== "sqlite") throw new Error("Expected fresh native rollback");
  const restored = new Database(join(state.binding.data.dataRoot, "quire.sqlite"), { readonly: true });
  const failed = new Database(join(owned.prior.data.dataRoot, "quire.sqlite"), { readonly: true });
  try {
    // This proves migration and pointer preparation preceded the real listener
    // construction failure; rollback is not a preflight-only rejection.
    expect(failed.query("SELECT value FROM installation_update_probe").all())
      .toEqual([{ value: "real-signed-migration" }]);
    expect(restored.query("SELECT name FROM sqlite_master WHERE name='installation_update_probe'").all()).toEqual([]);
  } finally { restored.close(); failed.close(); }
  const after = await Promise.all(owned.config.roles.map(role => inspectUnit(owned.config, role.unit)));
  for (let index = 0; index < after.length; index++) {
    expect(after[index]?.invocationId).not.toBe(before[index]?.invocationId);
    expect(after[index]?.state).toBe("active");
  }
  console.info("INSTALLATION_PREPARED_FAILURE_RESULT", JSON.stringify({ before, after, state, receipt }));
}, 180000);
