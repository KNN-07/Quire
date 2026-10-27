import { expect, test } from "bun:test";
import { endpoints, IdentityConfigSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";

const config = IdentityConfigSchema.parse({
  protocol: "oidc", enabled: false, requireSso: false, createOnLogin: false,
  breakGlassUserId: fixtureIds.operator, domains: [], mappings: [],
  attributes: { email: "email", name: "name", groups: "groups" },
  saml: null, ldap: null, oidc: { issuer: "https://issuer.example.test", clientId: "quire", scopes: ["openid"], secretPresent: true },
  version: 7,
});

test("distinguishes retain and remove when identity credentials cross the write boundary", () => {
  // Given: a fetched configuration with a saved credential.
  const { version, ...writable } = config;
  const input = { params: {}, query: {}, body: { ...writable, expectedVersion: version }, headers: { "if-match": '"v7"' } };
  // When: the operator retains, replaces or explicitly removes it.
  const retained = endpoints.identityConfigPut.input.parse(input);
  const replaced = endpoints.identityConfigPut.input.parse({ ...input, body: { ...input.body, oidcSecret: "new-fixture-secret" } });
  const removed = endpoints.identityConfigPut.input.parse({ ...input, body: { ...input.body, oidcSecret: "" } });
  // Then: each distinct command survives boundary parsing.
  expect(retained.body.oidcSecret).toBeUndefined();
  expect(replaced.body.oidcSecret).toBe("new-fixture-secret");
  expect(removed.body.oidcSecret).toBe("");
});

test("rejects credential bytes when an identity response crosses the read boundary", () => {
  // Given: a server attempting to echo a write-only field.
  const response = { ...config, oidcSecret: "must-not-return" };
  // When: the response parser validates the public shape.
  const parsed = endpoints.identityConfigGet.output.safeParse(response);
  // Then: the credential cannot enter client read state.
  expect(parsed.success).toBe(false);
});
