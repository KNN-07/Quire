import { expect, test } from "bun:test";
import { PresenceQueue } from "../../../services/core/review/presence";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("coalesces a trailing cursor with a controlled throttle clock", async () => {
  let now = 0;
  let scheduled: (() => void) | undefined;
  const cursors: (string | null)[] = [];
  const first = Promise.withResolvers<void>();
  const last = Promise.withResolvers<void>();
  const armed = Promise.withResolvers<void>();
  const queue = new PresenceQueue(async message => {
    cursors.push(message.cursor);
    if (message.cursor === "first") first.resolve();
    if (message.cursor === "last") last.resolve();
  }, () => now, (work, delay) => {
    expect(delay).toBe(50);
    scheduled = work;
    armed.resolve();
    return () => { scheduled = undefined; };
  });
  try {
    queue.push({ type: "presence", fileId: ids.mainFile, cursor: "first", name: "" });
    await first.promise;
    queue.push({ type: "presence", fileId: ids.mainFile, cursor: "middle", name: "" });
    queue.push({ type: "presence", fileId: ids.mainFile, cursor: "last", name: "" });
    await armed.promise;
    now = 50;
    if (!scheduled) throw new Error("Expected trailing cursor callback");
    scheduled();
    await last.promise;
    expect(cursors).toEqual(["first", "last"]);
  } finally { queue.close(); }
});

test("closing a presence queue cancels its pending trailing cursor", async () => {
  let scheduled: (() => void) | undefined;
  const first = Promise.withResolvers<void>();
  const armed = Promise.withResolvers<void>();
  const cursors: (string | null)[] = [];
  const queue = new PresenceQueue(async message => { cursors.push(message.cursor); first.resolve(); },
    () => 0, work => { scheduled = work; armed.resolve(); return () => { scheduled = undefined; }; });
  queue.push({ type: "presence", fileId: ids.mainFile, cursor: "first", name: "" });
  await first.promise;
  queue.push({ type: "presence", fileId: ids.mainFile, cursor: "pending", name: "" });
  await armed.promise;
  queue.close();
  expect(scheduled).toBeUndefined();
  queue.push({ type: "presence", fileId: ids.mainFile, cursor: "closed", name: "" });
  expect(cursors).toEqual(["first"]);
});
