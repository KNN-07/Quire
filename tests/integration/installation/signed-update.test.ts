import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { z } from "zod";
import { endpoints, UserSchema } from "@quire/contracts";
import { InstallationStateSchema } from "../../../services/operations/installation/model";
import { inspectUnit } from "../../../services/operations/installation/systemd-process";
import { fixtureIds } from "../../fixtures/foundation";
import { nativeInstallation, origin, password } from "./native-fixture";

async function login(port: number, email = "operator@quire.local") {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200) throw new Error(`Login failed: ${response.status}: ${await response.text()}`);
  z.object({ data: UserSchema }).parse(await response.json());
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected actual authenticated cookie");
  const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie, origin }, signal: AbortSignal.timeout(10000) });
  const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
  return { cookie, origin, "x-csrf-token": csrf };
}
async function submit(owned: Awaited<ReturnType<typeof nativeInstallation>>, headers: HeadersInit) {
  const receipt = owned.receiptWhen(row => ["succeeded", "failed"].includes(row.operation.status) || row.operation.errorCode !== null);
  void receipt.catch(() => undefined);
  try {
    const response = await fetch(`http://127.0.0.1:${owned.ports[0]}/api/admin/updates`, {
      method: "POST", headers: { ...Object.fromEntries(new Headers(headers)), "content-type": "application/json",
        "idempotency-key": "actual-signed-package" },
      // Exercise the real scheduler beyond the bounded 30-second control RPC;
      // completion is awaited through subscribed receipts/activation, not sleep.
      body: JSON.stringify({ releaseId: owned.release.id, at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false }),
      signal: AbortSignal.timeout(120000),
    });
    if (response.status !== 202) throw new Error(`Schedule failed: ${response.status}: ${await response.text()}`);
  } catch (error) {
    // Stop-all may disconnect the already accepted scheduling API response.
    // The subscribed durable receipt, not a reservation, must prove acceptance.
    if (!(error instanceof TypeError)) throw error;
  }
  return receipt;
}
function users(dataRoot: string) {
  const database = new Database(join(dataRoot, "quire.sqlite"), { readonly: true });
  try { return database.query("SELECT * FROM users ORDER BY id").all(); }
  finally { database.close(); }
}
async function source(port: number, headers: HeadersInit) {
  const response = await fetch(`http://127.0.0.1:${port}/api/projects/${fixtureIds.project}/files/${fixtureIds.mainFile}/content?branch=main`,
    { headers, signal: AbortSignal.timeout(10000) });
  if (response.status !== 200) throw new Error(`Source smoke failed: ${response.status}: ${await response.text()}`);
  return new Uint8Array(await response.arrayBuffer());
}

test("actual signed package migrates the stopped native installation and replaces both API invocations", async () => {
  await using owned = await nativeInstallation();
  await owned.start();
  const port = owned.ports[0];
  if (!port || owned.prior.data.dialect !== "sqlite") throw new Error("Expected native API binding");
  const operator = await login(port);
  const owner = await login(port, "kien@quire.local");
  const originalUsers = users(owned.prior.data.dataRoot);
  const originalSource = await source(port, owner);
  const before = await Promise.all(owned.config.roles.map(role => inspectUnit(owned.config, role.unit)));
  const active = owned.activatedAfter(0);
  const receipt = await submit(owned, operator);
  expect(receipt.operation.status, JSON.stringify(receipt.operation)).toBe("succeeded");
  await active;
  const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
  expect(state.mode).toBe("open");
  expect(state.floor).toEqual({ sequence: 2, version: "2.0.0" });
  expect(state.binding.data).toEqual(owned.prior.data);
  expect(state.binding.release.releaseId).toBe(owned.release.id);
  const database = new Database(join(owned.prior.data.dataRoot, "quire.sqlite"), { readonly: true });
  try {
    expect(database.query("SELECT value FROM installation_update_probe").all()).toEqual([{ value: "real-signed-migration" }]);
    expect(database.query("SELECT id FROM operations WHERE kind='update'").all()).toEqual([]);
    expect(database.query("SELECT operation_id FROM o_update_command_keys").all()).toEqual([{ operation_id: receipt.operation.id }]);
  } finally { database.close(); }
  expect(users(owned.prior.data.dataRoot)).toEqual(originalUsers);
  expect(await source(port, owner)).toEqual(originalSource);
  for (let i = 0; i < owned.config.roles.length; i++) {
    const role = owned.config.roles[i];
    if (!role) throw new Error("Expected API role");
    const current = await inspectUnit(owned.config, role.unit);
    expect(current.invocationId).not.toBe(before[i]?.invocationId);
  }
  const publicReceipt = await fetch(`http://127.0.0.1:${port}/api/operations/${receipt.operation.id}`,
    { headers: operator, signal: AbortSignal.timeout(10000) });
  expect(publicReceipt.status).toBe(200);
  expect(z.object({ data: endpoints.operationGet.output }).parse(await publicReceipt.json()).data).toEqual(receipt.operation);
}, 180000);

test("reported actual live migration failure restores original users and source into a fresh native generation", async () => {
  await using owned = await nativeInstallation({ migrationSql: `
    CREATE TABLE installation_update_probe(value TEXT NOT NULL);
    INSERT INTO installation_update_probe(value)
      SELECT CASE WHEN file LIKE '%/source/quire.sqlite' THEN NULL ELSE 'isolated-preflight-passed' END
      FROM pragma_database_list WHERE name='main';`,
  });
  await owned.start();
  const port = owned.ports[0];
  if (!port || owned.prior.data.dialect !== "sqlite") throw new Error("Expected native API binding");
  const operator = await login(port);
  const owner = await login(port, "kien@quire.local");
  const originalUsers = users(owned.prior.data.dataRoot);
  const originalSource = await source(port, owner);
  const active = owned.activatedAfter(0);
  const receipt = await submit(owned, operator);
  expect(receipt.operation.status, JSON.stringify(receipt.operation)).toBe("failed");
  expect(receipt.operation.result).toMatchObject({ rolledBack: true });
  await active;
  const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
  expect(state.mode).toBe("open");
  expect(state.floor).toEqual({ sequence: 1, version: "1.0.0" });
  expect(state.binding.release).toEqual(owned.prior.release);
  expect(state.binding.data.generationId).not.toBe(owned.prior.data.generationId);
  if (state.binding.data.dialect !== "sqlite") throw new Error("Expected fresh native rollback");
  expect(users(state.binding.data.dataRoot)).toEqual(originalUsers);
  expect(await source(port, owner)).toEqual(originalSource);
  const target = new Database(join(state.binding.data.dataRoot, "quire.sqlite"), { readonly: true });
  try { expect(target.query("SELECT name FROM sqlite_master WHERE name='installation_update_probe'").all()).toEqual([]); }
  finally { target.close(); }
}, 180000);
