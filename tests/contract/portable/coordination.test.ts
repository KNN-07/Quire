import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { IdSchema } from "@quire/contracts";
import { createRuntime } from "@quire/runtime";
import { nativeRepositoryPath, serializedRepository } from "../../../packages/runtime/src/repository-process";
import { barrier, fixture, fixedClock } from "./fixture";

test("durable branch fences reject stale takeover, renewal and release across restart", async () => {
  const time = fixedClock();
  const f = await fixture({ clock: time.clock });
  const scope = { projectId: IdSchema.parse(crypto.randomUUID()), branch: "main" };
  try {
    const wakes: string[] = [];
    const unsubscribe = f.runtime.branches.subscribe((value) => { wakes.push(value.branch); });
    const first = await f.runtime.branches.acquire(scope, "first", 1000);
    if (!first) throw new Error("Initial lease missing");
    expect(await f.runtime.branches.acquire(scope, "second", 1000)).toBeNull();
    await f.runtime.uow.run((tx) => f.runtime.branches.assert(tx, first));
    time.advance(1000);
    await rejects(f.runtime.branches.renew(first, 1000), { code: "STALE_BRANCH_FENCE" });
    const second = await f.runtime.branches.acquire(scope, "second", 1000);
    if (!second) throw new Error("Takeover failed");
    expect(second.fence).toBe(first.fence + 1);
    await rejects(f.runtime.uow.run((tx) => f.runtime.branches.assert(tx, first)), { code: "STALE_BRANCH_FENCE" });
    await f.runtime.branches.release(first);
    await f.runtime.uow.run((tx) => f.runtime.branches.assert(tx, second));
    const renewed = await f.runtime.branches.renew(second, 2000);
    expect(renewed.expiresAt > second.expiresAt).toBe(true);
    await f.runtime.branches.release(renewed);
    const third = await f.runtime.branches.acquire(scope, "third", 1000);
    expect(third?.fence).toBe(second.fence + 1);
    expect(wakes).toHaveLength(5);
    unsubscribe();
    await f.runtime.close();
    time.advance(1000);
    const reopened = await createRuntime(f.runtime.config, { clock: time.clock });
    try {
      expect((await reopened.branches.acquire(scope, "after-restart", 1000))?.fence).toBe((third?.fence ?? 0) + 1);
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test("takeover waits for the admitted repository execution gate without occupying SQL", async () => {
  const time = fixedClock();
  const f = await fixture({ clock: time.clock });
  const scope = { projectId: IdSchema.parse(crypto.randomUUID()), branch: "main" };
  const entered = barrier();
  const release = barrier();
  let work: Promise<void> | undefined;
  try {
    const first = await f.runtime.branches.acquire(scope, "first", 1000);
    if (!first) throw new Error("Lease unavailable");
    work = serializedRepository(nativeRepositoryPath(f.root, scope.projectId), async () => {
      entered.release();
      await release.promise;
    });
    await entered.promise;
    time.advance(1000);
    const takeover = f.runtime.branches.acquire(scope, "second", 1000);
    // A SQL round trip is an explicit barrier: acquisition must not have reached SQL.
    expect(await f.runtime.db.get<{ owner: string; fence: number }>("SELECT owner,fence FROM branch_leases"))
      .toEqual({ owner: "first", fence: first.fence });
    release.release();
    expect((await takeover)?.fence).toBe(first.fence + 1);
  } finally { release.release(); if (work) await work; await f.close(); }
});
