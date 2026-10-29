import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixture } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";

test("public domain discovery exposes only the configured organization and current provider availability", async () => {
  await using app = await fixture();
  const response = await app.request("/api/auth/discover?domain=EXAMPLE.TEST");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = resultSchema(endpoints.authDiscover.output).parse(await response.json());
  if (!("data" in result)) throw new Error(result.error.code);
  expect(result.data.organizations).toEqual([{
    id: fixtureIds.institution, name: "Quire Institute", provider: "oidc",
    capability: { enabled: true, state: "ready" },
  }]);
  const settings = await app.configurations.get();
  await app.runtime.uow.run(tx => app.configurations.save(tx, { ...settings,
    config: { ...settings.config, enabled: false } }));
  const disabled = resultSchema(endpoints.authDiscover.output).parse(
    await (await app.request("/api/auth/discover?domain=example.test")).json());
  if (!("data" in disabled)) throw new Error(disabled.error.code);
  expect(disabled.data.organizations[0]?.capability.enabled).toBe(false);
  expect(disabled.data.organizations[0]?.capability.state).toBe("disabled");
});

test("domain discovery does not infer provider authority from suffixes, account addresses or other organizations", async () => {
  await using app = await fixture();
  for (const domain of ["sub.example.test", "notexample.test", "example.test.evil", "quire.local"]) {
    const response = await app.request(`/api/auth/discover?domain=${domain}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { organizations: [] } });
  }
  for (const domain of ["person@example.test", "https://example.test", "example.test/path"]) {
    expect((await app.request(`/api/auth/discover?domain=${encodeURIComponent(domain)}`)).status).toBe(400);
  }
});
