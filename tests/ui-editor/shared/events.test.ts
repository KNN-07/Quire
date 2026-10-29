import { expect, test } from "bun:test";
import { nextApplicationEvent } from "./events";

test("disposing an unawaited canceled subscription preserves the original failed action", () => {
  let active = 0;
  const app = { application: { runtime: { events: { subscribe() {
    active++;
    return () => { active--; };
  } } } } };
  const failure = new Error("Controlled native action failure");
  expect(() => {
    using event = nextApplicationEvent(app, () => true);
    expect(active).toBe(1);
    expect(event.promise).toBeInstanceOf(Promise);
    throw failure;
  }).toThrow(failure);
  expect(active).toBe(0);
});

test("an explicitly awaited canceled subscription still rejects", async () => {
  let active = 0;
  const app = { application: { runtime: { events: { subscribe() {
    active++;
    return () => { active--; };
  } } } } };
  const event = nextApplicationEvent(app, () => true);
  event[Symbol.dispose]();
  const rejection: unknown = await event.promise.catch((error: unknown) => error);
  expect(rejection).toMatchObject({ name: "EventWaitError", reason: "disposed" });
  expect(active).toBe(0);
});
