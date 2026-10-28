import { expect, test } from "bun:test";
import { endpoints } from "@quire/contracts";
import { z } from "zod";
import { aiFixture } from "./harness";
import { providerServer } from "./provider";

test.each(["fixture-v2", "obsolete-version"])("consent discovery compares accepted terms with server configuration: %s", async termsVersion => {
  // Given: configured AI terms and an authenticated user without consent.
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin, { termsVersion: "fixture-v2" });
  const session = await fixture.login();
  const schema = z.object({ data: endpoints.aiConsentGet.output });
  expect((await fixture.request("/api/me/ai/consent")).status).toBe(401);
  const before = schema.parse(await (await fixture.request("/api/me/ai/consent", { headers: session.headers })).json()).data;
  expect(before).toMatchObject({
    requiredTermsVersion: "fixture-v2", acceptedTermsVersion: null, accepted: false, current: false,
  });
  // When: the user accepts terms with the exact server-returned user version.
  const response = await fixture.request("/api/me/ai-consent", {
    method: "POST", headers: session.headers,
    body: JSON.stringify({ termsVersion, accepted: true, expectedVersion: before.userVersion }),
  });
  expect(response.status).toBe(200);
  await fixture.restart();
  // Then: discovery reports durable consent and whether it matches the required terms.
  const after = schema.parse(await (await fixture.request("/api/me/ai/consent", { headers: session.headers })).json()).data;
  expect(after).toEqual({
    requiredTermsVersion: "fixture-v2", acceptedTermsVersion: termsVersion, accepted: true,
    current: termsVersion === "fixture-v2", userVersion: before.userVersion + 1,
  });
  expect(provider.received).toHaveLength(0);
});
