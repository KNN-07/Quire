import { expect, test } from "bun:test";
import { event, eventServer, subscription } from "./harness";

test("rewind preserves queued cursors while a callback awaits a normal same-origin API request", async () => {
  const apiEntered = Promise.withResolvers<void>();
  const apiResponse = Promise.withResolvers<Response>();
  await using server = eventServer(() => { apiEntered.resolve(); return apiResponse.promise; });
  const headers = Object.freeze({});
  await using slow = subscription({ client: server.client, headers, receive: async value => {
    if (value.seq === 1) {
      const stream = server.connections[0];
      if (!stream) throw new TypeError("Missing original connection");
      const response = await fetch(new URL("/api/probe", stream.request.url));
      expect(await response.text()).toBe("current actor");
    }
  } });
  await using fast = subscription({ client: server.client, headers });
  try {
    const original = await server.requests.next();
    await Promise.all([slow.opened, fast.opened]);
    original.send(event(1)); original.send(event(2));
    await apiEntered.promise;
    await fast.events.next(); await fast.events.next();
    expect(slow.received).toEqual([1]);
    await using late = subscription({ client: server.client, headers });
    const replay = await server.requests.next();
    await late.opened;
    replay.send(event(1)); replay.send(event(2)); replay.send(event(3));
    expect((await late.events.next()).seq).toBe(1);
    expect((await late.events.next()).seq).toBe(2);
    expect((await late.events.next()).seq).toBe(3);
    expect((await fast.events.next()).seq).toBe(3);
    expect(fast.received).toEqual([1, 2, 3]);
    expect(slow.received).toEqual([1]);
    apiResponse.resolve(new Response("current actor"));
    await slow.events.next(); await slow.events.next(); await slow.events.next();
    expect(slow.received).toEqual([1, 2, 3]);
  } finally { apiResponse.resolve(new Response("current actor")); }
});
