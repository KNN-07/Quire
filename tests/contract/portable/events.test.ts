import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { IdSchema } from "@quire/contracts";
import { SqliteEventPort } from "@quire/runtime";
import { barrier, fixture } from "./fixture";

const actor = IdSchema.parse("00000000-0000-4000-8000-000000000001");
const event = { topic: "session.revoked", aggregateId: actor, payload: { userId: actor, sessionId: null } } as const;

test("event counter, event and outbox roll back together", async () => {
  const f = await fixture();
  try {
    await rejects(f.runtime.uow.run(async (tx) => {
      await f.runtime.events.record(tx, event);
      throw new Error("abort event");
    }), /abort event/);
    expect(await f.runtime.events.read(0)).toEqual([]);
    expect(await f.runtime.db.get<{ value: number }>("SELECT value FROM event_counter")).toEqual({ value: 0 });
    expect(await f.runtime.db.all("SELECT * FROM outbox")).toEqual([]);
    const recorded = await f.runtime.uow.run((tx) => f.runtime.events.record(tx, event));
    expect(recorded.seq).toBe(1);
  } finally { await f.close(); }
});

test("a later transaction cannot publish past an earlier uncommitted sequence", async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  try {
    const completed: number[] = [];
    const first = f.runtime.uow.run(async (tx) => {
      const recorded = await f.runtime.events.record(tx, event);
      entered.release();
      await release.promise;
      return recorded;
    }).then((recorded) => { completed.push(recorded.seq); return recorded; });
    await entered.promise;
    // This transaction would complete first without the shared native gate.
    const second = f.runtime.uow.run((tx) => f.runtime.events.record(tx, event))
      .then((recorded) => { completed.push(recorded.seq); return recorded; });
    const replay = f.runtime.events.read(0);
    release.release();
    await Promise.all([first, second]);
    expect(completed).toEqual([1, 2]);
    expect((await replay).map((recorded) => recorded.seq)).toEqual([1, 2]);
    expect((await f.runtime.events.read(1)).map((recorded) => recorded.seq)).toEqual([2]);
  } finally { release.release(); await f.close(); }
});

test("independent dispatch cursors replay committed events even after outbox publication", async () => {
  const f = await fixture();
  const peer = new SqliteEventPort(f.runtime.db, f.runtime.clock);
  try {
    const delivered: number[] = [];
    const peerDelivered: number[] = [];
    f.runtime.events.subscribe((recorded) => { delivered.push(recorded.seq); });
    peer.subscribe((recorded) => { peerDelivered.push(recorded.seq); });
    await f.runtime.uow.run((tx) => f.runtime.events.record(tx, event));
    await f.runtime.events.dispatch();
    await peer.dispatch();
    await Promise.all([f.runtime.events.dispatch(), peer.dispatch()]);
    expect(delivered).toEqual([1]);
    expect(peerDelivered).toEqual([1]);
    expect(await f.runtime.db.get<{ attempts: number }>("SELECT attempts FROM outbox")).toEqual({ attempts: 2 });
  } finally { await peer.close(); await f.close(); }
});
