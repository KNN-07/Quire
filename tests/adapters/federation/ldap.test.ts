import { afterAll, beforeAll, expect, test } from "bun:test";
import { fixture } from "./harness";
import { ldapFixture } from "./ldap-fixture";
import { FederationLdap } from "../../../services/adapters/federation";
import { certificate } from "./signed-idp";

let directory: Awaited<ReturnType<typeof ldapFixture>>;
beforeAll(async () => { directory = await ldapFixture(); }, 45_000);
afterAll(async () => { await directory?.[Symbol.asyncDispose](); }, 15_000);
async function settings(app: Awaited<ReturnType<typeof fixture>>) {
  const current = await app.configurations.get();
  return { ...current, ldapSecret: "fixture-admin-password", config: {
    ...current.config, protocol: "ldap" as const,
    attributes: { email: "mail", name: "cn", groups: "description" },
    ldap: { url: directory.url, baseDn: "dc=example,dc=test", bindDn: "cn=admin,dc=example,dc=test",
      userFilter: "(uid={username})", caCertificate: directory.cert, secretPresent: true } } };
}
test("authenticates a real TLS directory user and maps immutable identity attributes", async () => {
  // Given
  await using app = await fixture();
  const protocol = new FederationLdap({ ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" });
  // When
  const result = await protocol.verify(await settings(app), { username: "researcher", password: "correct-directory-password" });
  // Then
  expect(result).toMatchObject({ issuer: directory.url, email: "directory@example.test", name: "Directory Researcher", groups: ["Researchers"] });
  expect(result.subject).toMatch(/^[0-9a-f-]{36}$/);
});
test("rejects invalid credentials when the directory service bind itself succeeds", async () => {
  // Given
  await using app = await fixture();
  const protocol = new FederationLdap({ ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" });
  // When
  const failure = await protocol.verify(await settings(app), { username: "researcher", password: "wrong" }).then(() => null, (error: unknown) => error);
  // Then
  expect(failure).toMatchObject({ code: "LDAP_CREDENTIALS_INVALID" });
});
test("rejects directory URLs absent from the exact allowlist", async () => {
  // Given
  await using app = await fixture();
  const protocol = new FederationLdap({ ldapAllowedUrls: [], ldapSubjectAttribute: "entryUUID" });
  // When
  const failure = await protocol.verify(await settings(app), { username: "researcher", password: "correct-directory-password" }).then(() => null, (error: unknown) => error);
  // Then
  expect(failure).toMatchObject({ code: "LDAP_DIRECTORY_DENIED" });
});
test("escapes LDAP filter metacharacters instead of expanding a supplied username", async () => {
  // Given
  await using app = await fixture();
  const protocol = new FederationLdap({ ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" });
  // When
  const failure = await protocol.verify(await settings(app), { username: "*", password: "correct-directory-password" }).then(() => null, (error: unknown) => error);
  // Then
  expect(failure).toMatchObject({ code: "LDAP_IDENTITY_INVALID" });
});
test("issues a real account session through the LDAP HTTP login endpoint", async () => {
  // Given
  await using app = await fixture({ ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" });
  const draft = await settings(app);
  await app.runtime.uow.run((tx) => app.configurations.save(tx, draft));
  // When
  const response = await app.request("/api/auth/ldap/login", { method: "POST",
    body: JSON.stringify({ username: "researcher", password: "correct-directory-password", returnTo: "/projects" }) });
  // Then
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { primaryEmail: "directory@example.test", managedBy: null } });
  expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith("quire_session="))).toBe(true);
});
test("completes an operator LDAP draft test only after actual user authentication", async () => {
  // Given
  await using app = await fixture({ ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" });
  const draft = await settings(app);
  const operator = await app.login();
  // When
  const response = await app.request("/api/admin/identity/test", { method: "POST",
    headers: { ...operator.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ draftConfig: draft.config, ldapSecret: draft.ldapSecret,
      ldapUsername: "researcher", ldapPassword: "correct-directory-password", nonce: "ldap-probe" }) });
  // Then
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ data: { status: "succeeded", result: { verified: true } } });
  expect(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='directory@example.test'")).toBeNull();
});
test("rejects the actual directory TLS certificate when another CA is configured", async () => {
  // Given
  await using app = await fixture();
  await using unrelated = await certificate();
  const draft = await settings(app);
  const protocol = new FederationLdap({ ldapAllowedUrls: [directory.url], ldapSubjectAttribute: "entryUUID" });
  // When
  const failure = await protocol.verify({ ...draft, config: { ...draft.config,
    ldap: { ...draft.config.ldap, caCertificate: unrelated.cert } } },
  { username: "researcher", password: "correct-directory-password" }).then(() => null, (error: unknown) => error);
  // Then
  expect(failure).toMatchObject({ code: "LDAP_DIRECTORY_FAILED" });
});
