import { SafeHttpClient } from "../../../services/adapters/shared";
import { adapterFixture } from "./harness";
import { providerServer } from "./provider-server";
import { fixtureContribution } from "./contribution";
import { configure, connect } from "./connection";

export async function connectedFixture(options: Parameters<typeof fixtureContribution>[0] = {}) {
  const provider = providerServer();
  try {
    const fixture = await adapterFixture({ contributions: [fixtureContribution(options)],
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
    try {
      const { operator } = await configure(fixture, provider.origin);
      const owner = await fixture.login();
      const grant = await connect(fixture, owner);
      async function action(parameters: Readonly<Record<string, unknown>> = { value: "first" }, input: {
        readonly key?: string; readonly expectedCursor?: string | null; readonly projectId?: string; readonly action?: string;
      } = {}) {
        return fixture.request(`/api/connections/${grant.id}/actions`, {
          method: "POST", headers: { ...owner.headers, "idempotency-key": input.key ?? crypto.randomUUID() },
          body: JSON.stringify({ action: input.action ?? "sync", parameters, expectedVersion: grant.version,
            expectedCursor: input.expectedCursor ?? null, ...(input.projectId ? { projectId: input.projectId } : {}) }),
        });
      }
      return { provider, fixture, owner, grant, operator, action,
        async [Symbol.asyncDispose]() { try { await fixture[Symbol.asyncDispose](); } finally { await provider[Symbol.asyncDispose](); } } };
    } catch (error) { await fixture[Symbol.asyncDispose](); throw error; }
  } catch (error) { await provider[Symbol.asyncDispose](); throw error; }
}
