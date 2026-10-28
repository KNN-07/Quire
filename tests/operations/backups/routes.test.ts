import { test, expect } from "bun:test";
import { z } from "zod";
import { BackupSchema, OperationSchema } from "@quire/contracts";
import { backupFixture, password } from "./fixture";
import { restoreConfirmation } from "../../../services/operations/backups";

async function login(fixture: Awaited<ReturnType<typeof backupFixture>>, email: string) {
  const response = await fixture.request("/api/auth/login", { body: { email, password } });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new TypeError(`Login failed: ${await response.text()}`);
  const me = await fixture.request("/api/me", { headers: { cookie } });
  const parsed = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json());
  return { cookie, "x-csrf-token": parsed.data.csrfToken };
}

test("requires current operator, fresh auth, CSRF and explicit target confirmation for backup routes", async () => {
  // Given ordinary and operator sessions on the real route registry.
  await using fixture = await backupFixture();
  const ordinary = await login(fixture, "kien@quire.local");
  const headers = await login(fixture, "operator@quire.local");
  expect((await fixture.request("/api/admin/backups", { headers: ordinary })).status).toBe(403);
  expect((await fixture.request("/api/admin/backups", { headers: { cookie: headers.cookie }, body: {} })).status).toBe(403);
  const created = await fixture.request("/api/admin/backups", { headers, body: {} });
  expect(created.status).toBe(202);
  const backup = z.object({ data: BackupSchema }).parse(await created.json()).data;
  // When restoration lacks explicit confirmation, followed by a confirmed isolated attempt.
  const denied = await fixture.request(`/api/admin/backups/${backup.id}/restore`, {
    headers, body: { target: "route-drill", confirmation: "", expectedVersion: 0 },
  });
  expect(denied.status).toBe(409);
  const restored = await fixture.request(`/api/admin/backups/${backup.id}/restore`, {
    headers, body: { target: "route-drill", confirmation: restoreConfirmation(backup.id, "route-drill"), expectedVersion: 0 },
  });
  // Then only the confirmed fresh operator action succeeds, and stale sessions cannot mutate.
  expect(restored.status).toBe(202);
  expect(z.object({ data: OperationSchema }).parse(await restored.json()).data.status).toBe("succeeded");
  fixture.setTime("2026-10-27T07:16:00.000Z");
  expect((await fixture.request("/api/admin/backups", { headers, body: {} })).status).toBe(403);
}, 120000);
