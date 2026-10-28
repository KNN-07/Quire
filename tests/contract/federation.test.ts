import { expect, test } from "bun:test";
import { endpoints, IdentityConfigSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../fixtures/foundation";

test("federation administration is operator-laned while LDAP login remains account-laned", () => {
  for (const route of [endpoints.identityConfigGet, endpoints.identityConfigPut, endpoints.identityTest,
    endpoints.identityMetadata, endpoints.scimToken, endpoints.identityBreakGlass, endpoints.identityCertificates]) {
    expect(route.lane).toBe("O");
  }
  expect(endpoints.ldapLogin.lane).toBe("A");
  expect(endpoints.ldapLogin.input.parse({ params: {}, query: {},
    body: { username: "researcher", password: "actual-bind-password", returnTo: "/projects" } }).body.username)
    .toBe("researcher");
});

test("identity configuration keeps its write schema and draft LDAP tests retain bind credentials", () => {
  const config = IdentityConfigSchema.parse({
    protocol: "ldap", enabled: false, requireSso: false, createOnLogin: false,
    breakGlassUserId: ids.operator, domains: [], mappings: [],
    attributes: { email: "mail", name: "cn", groups: "memberOf" },
    saml: null, oidc: null, ldap: { url: "ldaps://directory.example.test", baseDn: "dc=example,dc=test",
      bindDn: "cn=service", userFilter: "(uid={{username}})", caCertificate: "", secretPresent: false }, version: 0,
  });
  const { version, ...fields } = config;
  expect(endpoints.identityConfigPut.input.parse({
    params: {}, query: {}, body: { ...fields, expectedVersion: version, ldapSecret: "service-secret" },
    headers: { "if-match": '"v0"' },
  }).body.ldapSecret).toBe("service-secret");
  const testInput = endpoints.identityTest.input.parse({ params: {}, query: {},
    body: { draftConfig: config, nonce: "fixture-nonce", ldapUsername: "researcher", ldapPassword: "user-bind-secret" },
    headers: { "idempotency-key": "fixture-identity-test" },
  });
  expect(testInput.body.ldapUsername).toBe("researcher");
  expect(testInput.body.ldapPassword).toBe("user-bind-secret");
  expect(endpoints.identityCertificates.input.parse({ params: {}, query: {},
    body: { certificates: ["fixture-pem"], expectedVersion: 4 } }).body.expectedVersion).toBe(4);
});
