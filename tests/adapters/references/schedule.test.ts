import { expect, test } from "bun:test";
import { Library } from "../../../services/core/catalog";
import { referencesFixture } from "./harness";
import { referenceProvider } from "./provider";

test("runs only due collection schedules and drains the subscribed lifecycle with a controlled clock", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const selection = { libraryType: "users", libraryId: "123", collectionKey: "ABCD1234" } as const;
  const scheduler = fixture.references.scheduler;
  await scheduler.configure(owner.user.id, { grantId: grant.id, selection, intervalMs: 900_000 });
  const ticks = new Set<() => void>();
  scheduler.start({ subscribe(listener) { ticks.add(listener); return () => { ticks.delete(listener); }; } });
  await scheduler.runDue();
  const context = { ...fixture.runtime, routes: fixture.runtime.routes.forLane("X") };
  expect(await new Library(context).list(owner.user.id)).toEqual([]);
  fixture.clock.advance(900_000);
  // When
  for (const tick of ticks) tick();
  await scheduler.runDue();
  // Then
  expect(await new Library(context).list(owner.user.id)).toHaveLength(2);
  expect(await fixture.runtime.db.get<{ last_error: string | null }>("SELECT last_error FROM reference_schedules WHERE grant_id=?", [grant.id])).toEqual({ last_error: null });
  await scheduler.close();
  expect(ticks.size).toBe(0);
  const before = provider.state.requests.length;
  await fixture.restart();
  expect(provider.state.requests).toHaveLength(before);
  const row = await fixture.runtime.db.get("SELECT grant_id FROM reference_schedules WHERE grant_id=?", [grant.id]);
  expect(row).toEqual({ grant_id: grant.id });
});
