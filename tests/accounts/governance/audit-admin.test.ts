import { expect, test } from "bun:test";
import { z } from "zod";
import { AdminUserSummarySchema, AuditEntrySchema, OperationSchema, UserSchema, IdSchema } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { csv } from "../../../services/accounts/governance/reports";

test("escapes CSV quotes, multiline cells and spreadsheet formulas", () => {
  // Given: commas, quotes, CRLF and spreadsheet formula prefixes.
  const rows = [["name", "value"], ['a,"b"\r\nc', "=SUM(1,2)"], ["safe", " \t@command"]];
  // When: CSV is serialized.
  const result = new TextDecoder().decode(csv(rows));
  // Then: valid RFC-style quoted fields preserve data and neutralize formula evaluation.
  expect(result).toBe('"name","value"\r\n"a,""b""\r\nc","\'=SUM(1,2)"\r\n"safe","\' \t@command"\r\n');
});
test("paginates the audit by monotonic sequence with organization isolation", async () => {
  // Given: two scoped audit entries created through real writes.
  await using app = await governanceFixture();
  const admin = await app.login();
  await admin.write(`/api/organizations/${ids.team}`, { name: "First", expectedVersion: 0 }, { method: "PATCH" });
  await admin.write(`/api/organizations/${ids.team}`, { name: "Second", expectedVersion: 1 }, { method: "PATCH" });
  const first = await data(await admin.get(`/api/organizations/${ids.team}/audit?limit=1`), z.object({
    items: z.array(AuditEntrySchema), nextCursor: z.string().nullable(),
  }));
  // When: the second audit page uses the returned sequence cursor.
  const second = await data(await admin.get(`/api/organizations/${ids.team}/audit?limit=1&cursor=${first.nextCursor}`),
    z.object({ items: z.array(AuditEntrySchema), nextCursor: z.string().nullable() }));
  // Then: the page has no duplicate or missing sequence and another organization is inaccessible.
  expect(first.items).toHaveLength(1);
  expect(second.items[0]?.seq).toBe((first.items[0]?.seq ?? 0) + 1);
  expect(second.nextCursor).toBeNull();
  expect((await admin.get(`/api/organizations/${ids.institution}/audit`)).status).toBe(403);
});
test("exports a private persisted audit operation rather than a backup or leaked credentials", async () => {
  // Given: an audited organization mutation and a non-operator admin.
  await using app = await governanceFixture();
  const admin = await app.login();
  await admin.write(`/api/organizations/${ids.team}`, { name: 'Lab,"quoted"\nline', expectedVersion: 0 }, { method: "PATCH" });
  // When: the organization admin explicitly exports its audit.
  const operation = await data(await admin.write(`/api/organizations/${ids.team}/audit/export`), OperationSchema);
  // Then: the export contains actual CSV and remains owned by that actor.
  expect(operation.status).toBe("succeeded");
  const result = z.object({ format: z.literal("csv"), csv: z.string(), rows: z.number() }).parse(operation.result);
  expect(result.rows).toBe(1);
  expect(result.csv).not.toContain("password_hash");
  expect(z.object({ actor_id: IdSchema }).parse((await app.runtime.db.get("SELECT actor_id FROM operations WHERE id=?", [operation.id]))).actor_id).toBe(ids.kien);
  expect((await admin.get("/api/admin/audit")).status).toBe(403);
});
test("filters operator user listings by persisted membership and lifecycle state", async () => {
  // Given: a true operator, ordinary admin and suspended account.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const admin = await app.login();
  await app.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [ids.sam]);
  // When: the operator searches for the suspended guest by case-insensitive name.
  const page = await data(await operator.get("/api/admin/users?state=suspended&role=guest&q=SAM"),
    z.object({ items: z.array(AdminUserSummarySchema) }));
  // Then: the authoritative status is returned and an organization admin cannot use the operator route.
  expect(page.items.map((user) => user.id)).toEqual([ids.sam]);
  expect(page.items[0]?.suspended).toBe(true);
  expect((await admin.get("/api/admin/users")).status).toBe(403);
});
test("revokes independent sessions immediately when an operator suspends an account", async () => {
  // Given: two valid account sessions and a separate operator.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const first = await app.login("mai@quire.local");
  const second = await app.login("mai@quire.local");
  // When: an operator suspends the account at its fetched version.
  const response = await operator.write(`/api/admin/users/${ids.mai}`, { suspended: true, expectedVersion: 0 }, { method: "PATCH" });
  // Then: both live HTTP sessions fail authentication on the next call.
  expect((await data(response, UserSchema)).id).toBe(ids.mai);
  expect((await first.get("/api/me")).status).toBe(401);
  expect((await second.get("/api/me")).status).toBe(401);
});
test("invites an account through real verification and password setup links", async () => {
  // Given: the real operator invitation endpoint.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const invited = await data(await operator.write("/api/admin/users/invite", { name: "New user", email: "new@example.test" }), UserSchema);
  const mail = z.object({ body: z.string() }).parse((await app.runtime.db.get("SELECT body FROM mail_outbox WHERE recipient='new@example.test'", [])));
  const urls = mail.body.match(/http:\/\/[^\s]+/g) ?? [];
  const verify = urls.find((url) => new URL(url).pathname === "/verify-email");
  const reset = urls.find((url) => new URL(url).pathname === "/reset-password");
  if (!verify || !reset) throw new TypeError("Invitation setup URLs missing");
  // When: the recipient consumes both purpose-bound tokens through real public HTTP routes.
  const verification = await app.request("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token: new URL(verify).searchParams.get("token") }) });
  const setup = await app.request("/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({
    token: new URL(reset).searchParams.get("token"), password: "new-invited-password-2026",
  }) });
  // Then: the created account has verified email and a real Argon2 password, not a fabricated success.
  expect(verification.status).toBe(200);
  expect(setup.status).toBe(200);
  const row = z.object({ password_hash: z.string() }).parse((await app.runtime.db.get("SELECT password_hash FROM users WHERE id=?", [invited.id])));
  expect(await Bun.password.verify("new-invited-password-2026", row.password_hash)).toBe(true);
});
