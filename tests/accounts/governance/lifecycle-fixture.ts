import { expect } from "bun:test";
import { stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { IdSchema, ManagedLifecycleScheduleSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { Runtime } from "@quire/runtime";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { data, governanceFixture } from "./harness";

export async function lifecycleFixture() {
  const fixture = await governanceFixture();
  const root = fixture.runtime.config.dataDir;
  console.info("MANAGED_ACCOUNT_OWNED", { root });
  return { ...fixture, async [Symbol.asyncDispose]() {
    await fixture[Symbol.asyncDispose]();
    await rejects(stat(root), { code: "ENOENT" });
    console.info("MANAGED_ACCOUNT_CLOSED", { root });
  } };
}

type Session = { readonly headers: { readonly cookie: string; readonly "x-csrf-token": string } };
type Fixture = {
  readonly runtime: Runtime;
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
  readonly login: (email?: string) => Promise<Session>;
};
export const schedulePath = `/api/organizations/${ids.team}/managed-lifecycle`;
export const settings = { enabled: true, transferTo: ids.kien, softDeleteDays: 60, deletionDays: 90 };
export function lifecycleClient(fixture: Fixture, session: Session) {
  return {
    write: (path: string, body: unknown, method = "POST") => fixture.request(path, {
      method, headers: { ...session.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body),
    }),
    read: async () => data(await fixture.request(schedulePath, { headers: session.headers }),
      ManagedLifecycleScheduleSchema),
  };
}
export async function prepareLifecycle(fixture: Fixture) {
  const admin = await fixture.login();
  const api = lifecycleClient(fixture, admin);
  for (const [index, [userId, email]] of ([
    [ids.mai, "mai@quire.local"], [ids.sam, "sam@quire.local"], [ids.alex, "alex@quire.local"],
  ] as const).entries()) {
    expect((await api.write(`/api/organizations/${ids.team}/members`,
      { userId, role: "member", licensed: false, expectedVersion: index })).status).toBe(200);
    expect((await api.write(`/api/organizations/${ids.team}/managed/invite`,
      { userId, expectedVersion: index + 1 })).status).toBe(200);
    const row = z.object({ id: IdSchema }).parse(await fixture.runtime.db.get(
      "SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.team, userId]));
    const member = lifecycleClient(fixture, await fixture.login(email));
    expect((await member.write(`/api/managed/${row.id}/accept`, { expectedVersion: 0 })).status).toBe(200);
  }
  expect((await api.write(`/api/organizations/${ids.team}/managed/invite`, { userId: ids.kien, expectedVersion: 3 })).status).toBe(200);
  const recipient = z.object({ id: IdSchema }).parse(await fixture.runtime.db.get(
    "SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.team, ids.kien]));
  expect((await api.write(`/api/managed/${recipient.id}/accept`, { expectedVersion: 0 })).status).toBe(200);
  return { admin, api };
}
export async function lifecycleState(fixture: Fixture, userId: Id) {
  return z.object({ state: z.string(), version: z.number(), lapse_at: z.string().nullable() }).parse(
    await fixture.runtime.db.get("SELECT state,version,lapse_at FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.team, userId]));
}
export const transitionPath = (userId: Id) => `/api/organizations/${ids.team}/managed/${userId}/lifecycle`;
