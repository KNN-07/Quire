import { createClient, EventSchema } from "@quire/contracts";
import type { Event } from "@quire/contracts";
import { defaultPreferences, fixtureIds } from "../../fixtures/foundation";
import { editorEvents } from "../../../apps/web/src/features/editor/shared/events";

export function event(seq: number): Event {
  return EventSchema.parse({
    id: crypto.randomUUID(), aggregateId: fixtureIds.project, seq, at: "2026-10-28T00:00:00Z",
    topic: "job.changed", payload: { resourceId: fixtureIds.snapshot, status: "succeeded" },
  });
}

/** Exact event queues, with the Bun test deadline as the bounded failure guard. */
export class Queue<T> {
  private readonly values: T[] = [];
  private readonly readers: ((value: T) => void)[] = [];
  push(value: T): void {
    const reader = this.readers.shift();
    if (reader) reader(value);
    else this.values.push(value);
  }
  next(): Promise<T> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve(value);
    return new Promise(resolve => this.readers.push(resolve));
  }
}

export function eventServer(api?: (request: Request) => Promise<Response>) {
  type Connection = {
    readonly request: Request;
    readonly closed: Promise<void>;
    readonly send: (event: Event) => void;
    readonly bytes: (text: string) => void;
    readonly end: () => void;
  };
  const requests = new Queue<Connection>();
  const connections: Connection[] = [];
  let active = 0;
  let maximum = 0;
  const encoder = new TextEncoder();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (new URL(request.url).pathname !== "/api/events") {
      if (new URL(request.url).pathname !== "/api/me") {
        if (api) return api(request);
        throw new TypeError("Unexpected non-stream request");
      }
      return Response.json({ requestId: crypto.randomUUID(), data: {
        user: { id: fixtureIds.kien, name: "Kien", primaryEmail: "kien@quire.local",
          verifiedEmails: ["kien@quire.local"], managedBy: null, avatarBlob: null, latexName: "",
          affiliation: "", orcid: null, interfaceLanguage: "en" },
        preferences: defaultPreferences, capabilities: {}, csrfToken: "events-test-csrf",
      } });
    }
    const closed = Promise.withResolvers<void>();
    let output: ReadableStreamDefaultController<Uint8Array>;
    let ended = false;
    const close = () => {
      if (ended) return;
      ended = true;
      active--;
      request.signal.removeEventListener("abort", close);
      closed.resolve();
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) { output = controller; controller.enqueue(encoder.encode(": ready\n\n")); },
      cancel: close,
    });
    active++;
    maximum = Math.max(maximum, active);
    request.signal.addEventListener("abort", close, { once: true });
    const connection = {
      request, closed: closed.promise,
      send(value: Event) { output.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); },
      bytes(value: string) { output.enqueue(encoder.encode(value)); },
      end() { output.close(); close(); },
    };
    connections.push(connection);
    requests.push(connection);
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  } });
  return {
    client: createClient(server.url.origin), requests, connections,
    get active() { return active; },
    get maximum() { return maximum; },
    async [Symbol.asyncDispose]() { await server.stop(true); },
  };
}

export function subscription(
  input: Omit<Parameters<typeof editorEvents>[0], "signal" | "receive" | "onOpen"> & {
    readonly receive?: (event: Event) => void | Promise<void>;
  },
) {
  const abort = new AbortController();
  const events = new Queue<Event>();
  const opened = Promise.withResolvers<void>();
  const received: number[] = [];
  const task = editorEvents({ actorId: fixtureIds.kien, ...input, signal: abort.signal,
    onOpen() { opened.resolve(); },
    receive: async value => {
      received.push(value.seq);
      await input.receive?.(value);
      events.push(value);
    },
  });
  // Observe failures at creation; callers can still assert the rejection.
  void task.catch(() => {});
  return { task, events, opened: opened.promise, received, abort,
    async [Symbol.asyncDispose]() { abort.abort(); await task.catch(() => {}); },
  };
}
