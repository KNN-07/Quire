import { afterAll, beforeAll, expect, test } from "bun:test";
import { enqueueNotification } from "../../../services/accounts/governance";
import { fixtureIds } from "../../fixtures/foundation";
import { integrationFixture } from "./harness";
import type { IntegrationFixture } from "./harness";

const listeners = new Set<() => void>();
let fixture: IntegrationFixture;
beforeAll(async () => {
  // Real default-host startup executes the complete native toolchain probe.
  fixture = await integrationFixture({ schedulerTicks: { subscribe(listener: () => void) {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } } });
}, 90_000);
afterAll(async () => { await fixture?.[Symbol.asyncDispose](); }, 30_000);

test("scheduled delivery flushes only due digests and preserves one message across restart", async () => {
  // Given: actual persisted notification digests and a controlled host wake source.
  const due = fixture.clock.now();
  const future = new Date(Date.parse(due) + 60_000).toISOString();
  await fixture.runtime.uow.run(async tx => {
    const context = { ...fixture.runtime, db: tx, routes: fixture.runtime.routes.forLane("A") };
    for (const [key, at] of [["due", due], ["future", future]] as const) {
      await enqueueNotification(context, { userId: fixtureIds.kien, kind: "comment",
        resourceId: fixtureIds.project, projectId: fixtureIds.project, dedupeKey: key,
        mail: { subject: key, body: key, digestAt: at } });
    }
  });
  await fixture.start();
  // When: one host tick completes, followed by restart and another tick.
  for (const tick of listeners) tick();
  await fixture.adapters.close();
  const query = "SELECT dedupe_key FROM mail_outbox WHERE dedupe_key LIKE 'governance-digest:%' ORDER BY dedupe_key";
  const expected = [{ dedupe_key: `governance-digest:${fixtureIds.kien}:${due}` }];
  expect(await fixture.runtime.db.all(query)).toEqual(expected);
  await fixture.restart();
  await fixture.start();
  for (const tick of listeners) tick();
  await fixture.adapters.close();
  // Then: due mail is durable and deduplicated; future mail is not prematurely queued.
  expect(await fixture.runtime.db.all(query)).toEqual(expected);
  expect(await fixture.runtime.db.get("SELECT due_at FROM governance_digest_items WHERE sent_at IS NULL"))
    .toEqual({ due_at: future });
  expect(listeners.size).toBe(0);
}, 30_000);
