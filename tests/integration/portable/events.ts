import { EventSchema } from "@quire/contracts";
import type { Event } from "@quire/contracts";
import { bounded } from "./process";

export async function eventStream(url: string, headers: HeadersInit) {
  const abort = new AbortController();
  const response = await fetch(new URL("/api/events?after=0", url), { headers, signal: abort.signal });
  if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
  const reader = response.body.getReader();
  const ready = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const waiting = new Set<{ predicate: (event: Event) => boolean; resolve: (event: Event) => void }>();
  const events: Event[] = [];
  const reading = (async () => {
    const decoder = new TextDecoder();
    let pending = "";
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        pending += decoder.decode(item.value, { stream: true });
        let index: number;
        while ((index = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, index); pending = pending.slice(index + 2);
          if (frame.includes(": ready")) ready.resolve();
          const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
          if (!data) continue;
          const event = EventSchema.parse(JSON.parse(data));
          events.push(event);
          for (const waiter of waiting) if (waiter.predicate(event)) {
            waiting.delete(waiter); waiter.resolve(event);
          }
        }
      }
    } catch (error) { if (!abort.signal.aborted) throw error; }
    finally { closed.resolve(); reader.releaseLock(); }
  })();
  await bounded(ready.promise);
  return {
    events, closed: closed.promise,
    next(predicate: (event: Event) => boolean): Promise<Event> {
      const waiter = Promise.withResolvers<Event>();
      waiting.add({ predicate, resolve: waiter.resolve });
      return bounded(waiter.promise);
    },
    async [Symbol.asyncDispose]() { abort.abort(); await reading; },
  };
}
