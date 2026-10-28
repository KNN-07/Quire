import { expect, test } from "bun:test";
import { z } from "zod";
import { AuthOptionsSchema, IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { registerIdentityPolicy, enrollBreakGlass, requireEnrolledBreakGlass } from "../../../services/accounts/identity";
import { readLocalMail } from "../../../services/accounts/identity/mail";
import { fixtureIds } from "../../fixtures/foundation";
import { fixture, password } from "./harness";
import { errorSchema } from "./provider-fixture";

const policySchema = z.object({ requireSso: z.boolean(), breakGlassUserId: IdSchema.nullable() });
async function enforce(app: Awaited<ReturnType<typeof fixture>>) {
  await app.runtime.db.run("INSERT INTO operator_settings(key,value_json,updated_at) VALUES(?,?,?)",
    ["identity-test-policy", JSON.stringify({ requireSso: true, breakGlassUserId: fixtureIds.operator }), app.runtime.clock.now()]);
  registerIdentityPolicy(app.context, async (tx) => {
    const row = z.object({ value_json: z.string() }).parse(await tx.get("SELECT value_json FROM operator_settings WHERE key='identity-test-policy'"));
    return policySchema.parse(JSON.parse(row.value_json));
  });
}

test("denies ordinary password login and registration when require-SSO is enabled", async () => {
  // Given: configured SSO enforcement read from persisted operator settings.
  await using app = await fixture();
  await enforce(app);
  // When: an ordinary user submits valid password credentials.
  const response = await app.request("/api/auth/login", { method: "POST",
    body: JSON.stringify({ email: "kien@quire.local", password }) });
  // Then: password and registration discovery agree with the enforced boundary.
  expect(response.status).toBe(403);
  expect(errorSchema.parse(await response.json()).error.code).toBe("SSO_REQUIRED");
  const options = z.object({ data: z.object({ passwordEnabled: z.boolean(), registrationEnabled: z.boolean() }) })
    .parse(await (await app.request("/api/auth/options")).json()).data;
  expect(options).toEqual({ passwordEnabled: false, registrationEnabled: false });
  const register = await app.request("/api/auth/register", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ email: "new@example.test", name: "New", password }) });
  expect(register.status).toBe(403);
});

test("denies password bypass when the configured break-glass operator has not enrolled", async () => {
  // Given: an operator ID alone, without explicit enrollment.
  await using app = await fixture();
  await enforce(app);
  const row = z.object({ primary_email: z.string() }).parse(await app.runtime.db.get("SELECT primary_email FROM users WHERE id=?", [fixtureIds.operator]));
  // When: that operator attempts password recovery access.
  const response = await app.request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: row.primary_email, password }) });
  // Then: being the named operator is insufficient.
  expect(response.status).toBe(403);
  expect(errorSchema.parse(await response.json()).error.code).toBe("BREAKGLASS_ENROLLMENT_REQUIRED");
});

test("permits enrolled operator password recovery while SSO is required", async () => {
  // Given: a fresh operator explicitly enrolls using their current password.
  await using app = await fixture();
  const row = z.object({ primary_email: z.string() }).parse(await app.runtime.db.get("SELECT primary_email FROM users WHERE id=?", [fixtureIds.operator]));
  const operator = await app.login(row.primary_email);
  const principal = await app.runtime.services.get("identity").require(new Request("http://localhost/", { headers: operator.headers }));
  await enrollBreakGlass(app.context, { principal, password });
  await enforce(app);
  // When: the enrolled operator uses the ordinary reset flow.
  const response = await app.request("/api/auth/password-reset", { method: "POST", body: JSON.stringify({ email: row.primary_email }) });
  // Then: recovery and login remain available to that explicitly enrolled principal.
  expect(response.status).toBe(200);
  expect(readLocalMail(app.path).some((mail) => mail.recipient === row.primary_email)).toBe(true);
  expect((await app.login(row.primary_email)).user.id).toBe(fixtureIds.operator);
});

test("rejects ordinary recovery tokens issued before require-SSO was enabled", async () => {
  // Given: an ordinary user's valid recovery token predates SSO enforcement.
  await using app = await fixture();
  await app.request("/api/auth/password-reset", { method: "POST", body: JSON.stringify({ email: "kien@quire.local" }) });
  const mail = readLocalMail(app.path)[0];
  if (!mail) throw new TypeError("Recovery email missing");
  const token = new URL(mail.body.split("\n")[0] ?? "").searchParams.get("token");
  await enforce(app);
  // When: the old token is submitted.
  const response = await app.request("/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) });
  // Then: recovery cannot bypass current SSO enforcement.
  expect(response.status).toBe(403);
  expect(errorSchema.parse(await response.json()).error.code).toBe("SSO_REQUIRED");
});

test("rejects break-glass enrollment by a non-operator with a valid password", async () => {
  // Given: a fresh ordinary local session.
  await using app = await fixture();
  const local = await app.login();
  const principal = await app.runtime.services.get("identity").require(new Request("http://localhost/", { headers: local.headers }));
  // When: the ordinary account attempts explicit enrollment.
  const outcome = enrollBreakGlass(app.context, { principal, password });
  // Then: no operator privilege is created.
  expect(await outcome.catch((error: unknown) => {
    if (error instanceof ServiceError) return error;
    throw error;
  })).toMatchObject({ code: "FRESH_AUTH_REQUIRED" });
  expect(await requireEnrolledBreakGlass(app.context, local.user.id).catch((error: unknown) => {
    if (error instanceof ServiceError) return error;
    throw error;
  })).toMatchObject({ code: "BREAKGLASS_ENROLLMENT_REQUIRED" });
});

test("disables consumer OAuth discovery when institutional SSO is required", async () => {
  // Given: valid consumer provider configuration with institutional SSO enforcement.
  await using app = await fixture();
  await enforce(app);
  // When: an unauthenticated browser reads sign-in options.
  const response = await app.request("/api/auth/options");
  // Then: the UI sees those consumer providers as unavailable, matching the start endpoint.
  const options = z.object({ data: AuthOptionsSchema }).parse(await response.json()).data;
  expect(options.providers.every((entry) => !entry.capability.enabled && entry.capability.state === "disabled")).toBe(true);
  expect((await app.request("/api/auth/google/start?returnTo=/projects")).status).toBe(403);
});
