import { expect, test } from "bun:test";
import { createClient, EventSchema } from "@quire/contracts";
import type { Event } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { PdfEvents } from "../../../apps/web/src/features/editor/pdf/events";

const workspace = { scope: { projectId: fixtureIds.project, branch: "main" },
  requestHeaders: { "x-project-token": "scoped-test-token" } } as const;
const completed = EventSchema.parse({
  id: fixtureIds.mainFile, aggregateId: fixtureIds.project, seq: 1, at: "2026-10-27T00:00:00Z",
  topic: "job.changed", payload: { resourceId: fixtureIds.snapshot, status: "succeeded" },
});

test("forwards scoped credentials and delivers only scoped multiline SSE events", async () => {
  // Given a real HTTP stream and subscriptions installed before any event bytes.
  const resources = new AsyncDisposableStack();
  try {
    const body = new TransformStream<Uint8Array, Uint8Array>();
    const writer = body.writable.getWriter();
    const request = Promise.withResolvers<Request>();
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(input) {
      request.resolve(input);
      return new Response(body.readable, { headers: { "content-type": "text/event-stream" } });
    } });
    resources.defer(async () => { writer.releaseLock(); await server.stop(true); });
    const failure = Promise.withResolvers<never>();
    const events = new PdfEvents(createClient(server.url.origin), workspace, error => failure.reject(error));
    resources.defer(() => events.dispose());
    const received = Promise.withResolvers<Event>();
    resources.defer(events.subscribe(event => received.resolve(event)));
    const timeout = setTimeout(() => received.reject(new Error("Expected scoped SSE event not delivered")), 5_000);
    resources.defer(() => clearTimeout(timeout));
    const result = Promise.race([received.promise, failure.promise]);
    const encode = (value: string) => new TextEncoder().encode(value);
    await writer.write(encode(": connected\n\n"));
    await events.connected();
    const input = await request.promise;
    expect(input.headers.get("x-project-token")).toBe("scoped-test-token");
    expect(new URL(input.url).searchParams.toString()).toBe("after=0");
    // When an unrelated event precedes a multiline scoped event.
    await writer.write(encode(`data: ${JSON.stringify({ ...completed, aggregateId: fixtureIds.team })}\n\n`));
    const json = JSON.stringify(completed);
    const comma = json.indexOf(",");
    await writer.write(encode(`data: ${json.slice(0, comma + 1)}\ndata: ${json.slice(comma + 1)}\n`));
    await writer.write(encode("\n"));
    // Then only the correctly parsed project event is delivered.
    expect(await result).toEqual(completed);
  } finally { await resources.disposeAsync(); }
});

test("rejects invalid event payloads at the SSE boundary", async () => {
  // Given a real HTTP stream observed through the production parser.
  const body = new TransformStream<Uint8Array, Uint8Array>();
  const writer = body.writable.getWriter();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => new Response(body.readable, { headers: { "content-type": "text/event-stream" } }) });
  const failure = Promise.withResolvers<Error>();
  const events = new PdfEvents(createClient(server.url.origin), workspace, error => failure.resolve(error));
  const timeout = setTimeout(() => failure.reject(new Error("Invalid SSE payload was not rejected")), 5_000);
  try {
    await writer.write(new TextEncoder().encode(": connected\n\n"));
    await events.connected();
    // When the wire sends an invalid job status.
    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({
      ...completed, payload: { resourceId: fixtureIds.snapshot, status: "fabricated" },
    })}\n\n`));
    // Then schema failure, rather than an invented job state, is exposed.
    expect((await failure.promise).name).toBe("ZodError");
  } finally {
    clearTimeout(timeout); await events.dispose(); writer.releaseLock(); await server.stop(true);
  }
});

test("disposal rejects startup and closes a stream before headers arrive", async () => {
  // Given a pending HTTP response and a subscribed startup promise.
  const requested = Promise.withResolvers<void>();
  const body = new TransformStream<Uint8Array, Uint8Array>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    requested.resolve();
    return new Response(body.readable, { headers: { "content-type": "text/event-stream" } });
  } });
  const reported: Error[] = [];
  const events = new PdfEvents(createClient(server.url.origin), workspace, error => reported.push(error));
  const rejected = events.connected().catch((error: unknown) => {
    if (error instanceof Error) return error;
    throw error;
  });
  const deadline = setTimeout(() => requested.reject(new Error("Startup request not observed")), 5_000);
  try {
    await requested.promise;
    // When disposal interrupts startup instead of waiting for a first frame.
    await events.dispose();
    // Then the subscribed startup rejects and disposal settles.
    const error = await rejected;
    if (!(error instanceof Error)) throw new TypeError("Startup unexpectedly completed");
    expect(error.name).toBe("AbortError");
    expect(reported).toEqual([]);
  } finally { clearTimeout(deadline); await events.dispose(); await server.stop(true); }
});
