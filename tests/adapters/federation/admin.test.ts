import { expect, test } from "bun:test";
import { z } from "zod";
import { resourceVersionTag } from "@quire/contracts";
import { fixture, password } from "./harness";
import { enrollFederationBreakGlass } from "../../../services/adapters/federation";
import { fixtureIds } from "../../fixtures/foundation";

test("rejects require-SSO when the designated operator has not explicitly enrolled", async () => {
  // Given
  await using app = await fixture();
  const current = await app.configurations.get();
  // When
  const failure = await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...current,
    config: { ...current.config, requireSso: true } })).then(() => null, (error: unknown) => error);
  // Then
  expect(failure).toMatchObject({ code: "BREAKGLASS_ENROLLMENT_REQUIRED" });
});
for (const example of [{ email: "kien@quire.local", status: 403 }, { email: "operator@quire.local", status: 200 }] as const) {
test(`returns HTTP ${example.status} when ${example.email} uses a password under require-SSO`, async () => {
  // Given
  await using app = await fixture();
  const operator = await app.login();
  const request = new Request(new URL("/api/admin/identity/break-glass", app.runtime.config.publicUrl), { method: "POST",
    headers: { ...operator.headers, origin: new URL(app.runtime.config.publicUrl).origin } });
  await enrollFederationBreakGlass(app.context, { request, requestId: fixtureIds.operator, responseHeaders: new Headers() }, password);
  const current = await app.configurations.get();
  await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...current, config: { ...current.config, requireSso: true } }));
  // When
  const response = await app.request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: example.email, password }) });
  // Then
  expect(response.status).toBe(example.status);
});
}
test("redacts persisted credentials when an operator saves identity configuration", async () => {
  // Given
  await using app = await fixture();
  const operator = await app.login();
  const { config } = await app.configurations.get();
  const { version, ...draft } = config;
  // When
  const response = await app.request("/api/admin/identity", { method: "PUT",
    headers: { ...operator.headers, "if-match": resourceVersionTag(version) },
    body: JSON.stringify({ ...draft, expectedVersion: version, oidcSecret: "rotated-secret-value" }) });
  // Then
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("rotated-secret-value");
  const stored = z.object({ config_json: z.string(), oidc_secret: z.instanceof(Uint8Array) })
    .parse(await app.runtime.db.get("SELECT config_json,oidc_secret FROM federation_configuration"));
  expect(stored.config_json).not.toContain("rotated-secret-value");
  expect(Buffer.from(stored.oidc_secret).includes(Buffer.from("rotated-secret-value"))).toBe(false);
});
test("only succeeds a draft OIDC test after an actual signed callback without creating an account", async () => {
  // Given
  await using app = await fixture();
  const operator = await app.login();
  const { config } = await app.configurations.get();
  const started = await app.request("/api/admin/identity/test", { method: "POST",
    headers: { ...operator.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ draftConfig: config, nonce: "operator-challenge" }) });
  const operation = z.object({ data: z.object({ id: z.string(), status: z.string(), result: z.object({ authorizationUrl: z.string() }) }) }).parse(await started.json()).data;
  expect(operation.status).toBe("running");
  const authorization = await fetch(operation.result.authorizationUrl, { redirect: "manual", signal: AbortSignal.timeout(5000) });
  const location = new URL(authorization.headers.get("location") ?? "");
  const cookie = started.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  // When
  const callback = await app.request(location.pathname + location.search, { headers: { cookie } });
  // Then
  expect(callback.status).toBe(303);
  expect(z.object({ status: z.string() }).parse(await app.runtime.db.get("SELECT status FROM operations WHERE id=?", [operation.id])).status).toBe("succeeded");
  expect(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='external@example.test'")).toBeNull();
});
