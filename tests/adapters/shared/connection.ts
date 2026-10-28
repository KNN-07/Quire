import { z } from "zod";
import { AdapterGrantSchema, ProviderConfigSchema } from "@quire/contracts";
import type { AdapterFixture, FixtureSession } from "./harness";
import { defaultPolicy } from "../../fixtures/foundation";

export const grantsEnvelope = z.object({ data: z.object({ items: z.array(AdapterGrantSchema), nextCursor: z.string().nullable() }) });
export async function configure(fixture: AdapterFixture, origin: string) {
  const operator = await fixture.login("operator@quire.local");
  const response = await fixture.request("/api/admin/providers/fixture", {
    method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
    body: JSON.stringify({ baseUrl: origin, secret: "fixture-client-secret", policy: defaultPolicy, expectedVersion: 0 }),
  });
  return { operator, configuration: z.object({ data: ProviderConfigSchema }).parse(await response.json()).data };
}
export async function authorization(fixture: AdapterFixture, session: FixtureSession) {
  const response = await fixture.request("/api/connections/fixture/start", {
    method: "POST", headers: session.headers, body: JSON.stringify({ returnTo: "/settings/connections" }),
  });
  const url = z.object({ data: z.object({ url: z.url() }) }).parse(await response.json()).data.url;
  const accepted = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
  const location = accepted.headers.get("location");
  if (!location) throw new TypeError("Fixture authorization did not issue a callback");
  const callback = new URL(location);
  return { authorizationUrl: url, callback: callback.pathname + callback.search };
}
export async function connect(fixture: AdapterFixture, session: FixtureSession) {
  const started = await authorization(fixture, session);
  const response = await fixture.request(started.callback, { headers: session.headers });
  if (response.status !== 303) throw new TypeError(`Connection failed: ${response.status} ${await response.text()}`);
  const list = await fixture.request("/api/connections", { headers: session.headers });
  const grant = grantsEnvelope.parse(await list.json()).data.items[0];
  if (!grant) throw new TypeError("Connection did not persist a grant");
  return grant;
}
