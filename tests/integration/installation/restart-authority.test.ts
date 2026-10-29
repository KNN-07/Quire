import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, resultSchema } from "@quire/contracts";
import { InstallationStateSchema } from "../../../services/operations/installation/model";
import { nativeInstallation, origin, password } from "./native-fixture";

test("promoted floor and byte-equivalent completed receipt survive controller restart and deny replay", async () => {
  await using owned = await nativeInstallation();
  await owned.start();
  const port = owned.apiPort;
  if (!port) throw new Error("Missing installed API");
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "operator@quire.local", password }), signal: AbortSignal.timeout(10000),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Missing operator session");
  const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie, origin }, signal: AbortSignal.timeout(10000) });
  const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
  const headers = { cookie, origin, "content-type": "application/json", "x-csrf-token": csrf };
  const body = { releaseId: owned.release.id, at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false };
  const active = owned.activatedAfter(0);
  const receipt = owned.receiptWhen(row => ["succeeded", "failed"].includes(row.operation.status));
  const finished = Promise.all([receipt, active]);
  void finished.catch(() => undefined);
  const accepted = await fetch(`http://127.0.0.1:${port}/api/admin/updates`, {
    method: "POST", headers: { ...headers, "idempotency-key": "restart-authority-original" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  expect(accepted.status).toBe(202);
  const [completed] = await finished;
  expect(completed.operation.status, JSON.stringify(completed.operation)).toBe("succeeded");
  const before = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
  const original = JSON.stringify(await owned.control({ method: "get", input: { id: completed.operation.id } }));
  expect(before.floor).toEqual({ sequence: 2, version: "2.0.0" });
  await owned.killController();
  await owned.start();
  const after = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
  expect(after.mode).toBe("open");
  expect(after.supervisorEpoch).not.toBe(before.supervisorEpoch);
  expect(after.floor).toEqual(before.floor);
  expect(after.binding).toEqual(before.binding);
  expect(JSON.stringify(await owned.control({ method: "get", input: { id: completed.operation.id } }))).toBe(original);
  const publicReceipt = await fetch(`http://127.0.0.1:${port}/api/operations/${completed.operation.id}`, {
    headers, signal: AbortSignal.timeout(10000),
  });
  expect(publicReceipt.status).toBe(200);
  expect(await publicReceipt.json()).toMatchObject({ data: completed.operation });
  const repeat = await fetch(`http://127.0.0.1:${port}/api/admin/updates`, {
    method: "POST", headers: { ...headers, "idempotency-key": "restart-authority-original" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  expect(repeat.status).toBe(202);
  expect(await repeat.json()).toMatchObject({ data: completed.operation });
  const denied = await fetch(`http://127.0.0.1:${port}/api/admin/updates`, {
    method: "POST", headers: { ...headers, "idempotency-key": "restart-authority-new" },
    body: JSON.stringify({ ...body, at: new Date(Date.now() + 60000).toISOString() }), signal: AbortSignal.timeout(10000),
  });
  expect(denied.status).toBe(409);
  const rejection = resultSchema(endpoints.updateCreate.output).parse(await denied.json());
  if (!("error" in rejection)) throw new Error("Same sequence unexpectedly accepted");
  expect(rejection.error.code).toBe("REPLAY_OR_DOWNGRADE");
  const settled = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
  expect(settled.floor).toEqual(before.floor);
  expect(settled.binding).toEqual(before.binding);
  expect(JSON.stringify(await owned.control({ method: "get", input: { id: completed.operation.id } }))).toBe(original);
  console.info("INSTALLATION_RESTART_AUTHORITY", { before, after, operation: completed.operation, rejection });
}, 300000);
