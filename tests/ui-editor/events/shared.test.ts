import { expect, test } from "bun:test";
import { createClient } from "@quire/contracts";
import { editorEvents } from "../../../apps/web/src/features/editor/shared/events";
import { assistantEvents } from "../../../apps/web/src/features/editor/assistant/events";
import { PdfEvents } from "../../../apps/web/src/features/editor/pdf/events";
import { subscribeProjectEvents } from "../../../apps/web/src/features/editor/review/events";
import { fixtureIds } from "../../fixtures/foundation";
import { event, eventServer, Queue, subscription } from "./harness";

test("one workspace shares assistant PDF and review streams with independent cancellation", async () => {
  await using server = eventServer();
  const headers = Object.freeze({});
  const workspace = { scope: { projectId: fixtureIds.project, branch: "main" }, requestHeaders: headers,
    access: { actorId: fixtureIds.kien } };
  // PdfEvents deliberately accepts the same minimal workspace contract as before.
  const pdf = new PdfEvents(server.client, workspace, error => { throw error; });
  const pdfEvents = new Queue<number>();
  pdf.subscribe(value => pdfEvents.push(value.seq));
  const assistantAbort = new AbortController();
  const assistantQueue = new Queue<number>();
  const assistant = assistantEvents({ client: server.client, headers, signal: assistantAbort.signal,
    receive: value => { assistantQueue.push(value.seq); return Promise.resolve(); } });
  const reviewQueue = new Queue<number>();
  const reviewOpened = Promise.withResolvers<void>();
  const review = subscribeProjectEvents({ client: server.client, workspace,
    topics: new Set(["job.changed"]), onOpen: () => reviewOpened.resolve(),
    onEvent: value => reviewQueue.push(value.seq) });
  try {
    const stream = await server.requests.next();
    await Promise.all([pdf.connected(), reviewOpened.promise]);
    stream.send(event(1));
    expect(await pdfEvents.next()).toBe(1);
    expect(await assistantQueue.next()).toBe(1);
    expect(await reviewQueue.next()).toBe(1);
    expect(server.connections).toHaveLength(1);
    expect(new URL(stream.request.url).searchParams.get("after")).toBe("0");
    assistantAbort.abort();
    await assistant;
    await pdf.dispose();
    expect(server.active).toBe(1);
    stream.send(event(2));
    expect(await reviewQueue.next()).toBe(2);
    review.dispose();
    await review.promise;
    await stream.closed;
    expect(server.active).toBe(0);
  } finally {
    assistantAbort.abort(); review.dispose();
    await assistant; await pdf.dispose(); await review.promise;
  }
});

test("standalone PDF readers without session metadata never share even identical header objects", async () => {
  await using server = eventServer();
  const workspace = { scope: { projectId: fixtureIds.project, branch: "main" }, requestHeaders: Object.freeze({}) };
  const errors: Error[] = [];
  const first = new PdfEvents(server.client, workspace, error => errors.push(error));
  let second: PdfEvents | null = null;
  const firstEvents = new Queue<number>();
  const secondEvents = new Queue<number>();
  first.subscribe(value => firstEvents.push(value.seq));
  try {
    const firstStream = await server.requests.next();
    await first.connected();
    second = new PdfEvents(server.client, workspace, error => errors.push(error));
    second.subscribe(value => secondEvents.push(value.seq));
    const secondStream = await server.requests.next();
    await second.connected();
    firstStream.send(event(1)); secondStream.send(event(2));
    expect(await firstEvents.next()).toBe(1);
    expect(await secondEvents.next()).toBe(2);
    expect(server.connections).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally { await Promise.all([first.dispose(), second?.dispose()]); }
});

test("late subscribers replay from the server without duplicating existing callbacks", async () => {
  await using server = eventServer();
  const headers = Object.freeze({ "x-project-token": "first-workspace-token" });
  await using first = subscription({ client: server.client, headers });
  const original = await server.requests.next();
  await first.opened;
  original.send(event(1));
  original.send(event(2));
  await first.events.next(); await first.events.next();
  await using late = subscription({ client: server.client, headers });
  const replay = await server.requests.next();
  await original.closed;
  await late.opened;
  expect(new URL(replay.request.url).searchParams.get("after")).toBe("0");
  replay.send(event(1)); replay.send(event(2)); replay.send(event(3));
  expect((await late.events.next()).seq).toBe(1);
  expect((await late.events.next()).seq).toBe(2);
  expect((await late.events.next()).seq).toBe(3);
  expect((await first.events.next()).seq).toBe(3);
  expect(first.received).toEqual([1, 2, 3]);
  expect(late.received).toEqual([1, 2, 3]);
  expect(server.active).toBe(1);
  expect(replay.request.headers.get("x-project-token")).toBe("first-workspace-token");
});

test("refreshed and derived header objects share only the same explicit actor and token", async () => {
  await using server = eventServer();
  const headers = Object.freeze({ "x-project-token": "same-token" });
  await using first = subscription({ client: server.client, headers, actorId: fixtureIds.kien });
  await using refreshed = subscription({ client: server.client, headers: { ...headers }, actorId: fixtureIds.kien });
  const stream = await server.requests.next();
  await Promise.all([first.opened, refreshed.opened]);
  stream.send(event(1));
  await first.events.next(); await refreshed.events.next();
  expect(server.connections).toHaveLength(1);
  await using token = subscription({ client: server.client,
    headers: { "x-project-token": "replacement-token" }, actorId: fixtureIds.kien });
  const isolated = await server.requests.next();
  await token.opened;
  isolated.send(event(2));
  expect((await token.events.next()).seq).toBe(2);
  expect(first.received).toEqual([1]);
  expect(refreshed.received).toEqual([1]);
  expect(token.received).toEqual([2]);
});

test("a subscriber cursor cannot become the startup cursor of another subscriber", async () => {
  await using server = eventServer();
  const headers = Object.freeze({});
  await using resumed = subscription({ client: server.client, headers, after: 9 });
  const initial = await server.requests.next();
  await resumed.opened;
  expect(new URL(initial.request.url).searchParams.get("after")).toBe("9");
  await using startup = subscription({ client: server.client, headers });
  const replay = await server.requests.next();
  await startup.opened;
  expect(new URL(replay.request.url).searchParams.get("after")).toBe("0");
  replay.send(event(1)); replay.send(event(10));
  expect((await startup.events.next()).seq).toBe(1);
  expect((await startup.events.next()).seq).toBe(10);
  expect((await resumed.events.next()).seq).toBe(10);
  expect(resumed.received).toEqual([10]);
});

test("actor claims cannot authorize sharing and different tokens or clients never reuse a stream", async () => {
  await using server = eventServer();
  const ownerHeaders = Object.freeze({});
  await using owner = subscription({ client: server.client, headers: ownerHeaders });
  const ownerStream = await server.requests.next();
  await owner.opened;
  ownerStream.send(event(1));
  await owner.events.next();
  await using actor = subscription({ client: server.client, headers: Object.freeze({}), actorId: fixtureIds.mai });
  expect(await actor.task.catch((error: unknown) => error)).toMatchObject({ code: "EVENT_AUTHORITY_CHANGED" });
  await using token = subscription({ client: server.client, headers: Object.freeze({ "x-project-token": "other-token" }) });
  const tokenStream = await server.requests.next();
  await token.opened;
  await using client = subscription({ client: createClient(new URL(ownerStream.request.url).origin), headers: ownerHeaders });
  const clientStream = await server.requests.next();
  await client.opened;
  tokenStream.send(event(3)); clientStream.send(event(4));
  await token.events.next(); await client.events.next();
  expect(owner.received).toEqual([1]);
  expect(actor.received).toEqual([]);
  expect(token.received).toEqual([3]);
  expect(client.received).toEqual([4]);
  expect(tokenStream.request.headers.get("x-project-token")).toBe("other-token");
  expect(server.connections).toHaveLength(3);
});

test("slow callbacks keep their own ordering without blocking other consumers", async () => {
  await using server = eventServer();
  const headers = Object.freeze({});
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await using slow = subscription({ client: server.client, headers, receive: async value => {
    if (value.seq === 1) { entered.resolve(); await release.promise; }
  } });
  await using fast = subscription({ client: server.client, headers });
  try {
    const stream = await server.requests.next();
    await Promise.all([slow.opened, fast.opened]);
    stream.send(event(1)); stream.send(event(2));
    await entered.promise;
    expect((await fast.events.next()).seq).toBe(1);
    expect((await fast.events.next()).seq).toBe(2);
    expect(slow.received).toEqual([1]);
    release.resolve();
    await slow.events.next(); await slow.events.next();
    expect(slow.received).toEqual([1, 2]);
  } finally { release.resolve(); }
});

test("callback failure detaches only that subscriber and does not poison later subscribers", async () => {
  await using server = eventServer();
  const headers = Object.freeze({});
  const failure = new Error("Controlled callback failure");
  await using broken = subscription({ client: server.client, headers, receive() { throw failure; } });
  await using healthy = subscription({ client: server.client, headers });
  const stream = await server.requests.next();
  await healthy.opened;
  stream.send(event(1));
  expect(await broken.task.catch((error: unknown) => error)).toBe(failure);
  expect((await healthy.events.next()).seq).toBe(1);
  stream.send(event(2));
  expect((await healthy.events.next()).seq).toBe(2);
  expect(server.active).toBe(1);
});

test("EOF reports failure after queued callbacks and the next subscription opens a clean stream", async () => {
  await using server = eventServer();
  const headers = Object.freeze({});
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await using first = subscription({ client: server.client, headers, receive: async value => {
    if (value.seq === 1) { entered.resolve(); await release.promise; }
  } });
  try {
    const stream = await server.requests.next();
    await first.opened;
    stream.send(event(1)); stream.send(event(2));
    await entered.promise;
    stream.end();
    release.resolve();
    expect((await first.events.next()).seq).toBe(1);
    expect((await first.events.next()).seq).toBe(2);
    expect(await first.task.catch((error: unknown) => error)).toBeInstanceOf(TypeError);
    await using next = subscription({ client: server.client, headers });
    const fresh = await server.requests.next();
    await next.opened;
    fresh.send(event(3));
    expect((await next.events.next()).seq).toBe(3);
    expect(next.received).toEqual([3]);
    expect(server.connections).toHaveLength(2);
  } finally { release.resolve(); }
});

test("abandoned pending streams are removed and a pre-aborted subscriber never opens one", async () => {
  await using server = eventServer();
  const headers = Object.freeze({});
  const aborted = new AbortController();
  aborted.abort();
  await editorEvents({ client: server.client, headers, signal: aborted.signal, receive() {} });
  expect(server.connections).toHaveLength(0);
  await using abandoned = subscription({ client: server.client, headers });
  const stream = await server.requests.next();
  abandoned.abort.abort();
  await abandoned.task;
  await stream.closed;
  await using next = subscription({ client: server.client, headers });
  const fresh = await server.requests.next();
  await next.opened;
  expect(fresh).not.toBe(stream);
  expect(server.active).toBe(1);
  expect(server.connections).toHaveLength(2);
});

test("split CRLF and multiline frames use the same validated parser", async () => {
  await using server = eventServer();
  await using first = subscription({ client: server.client, headers: Object.freeze({}) });
  const stream = await server.requests.next();
  await first.opened;
  const value = event(1);
  const json = JSON.stringify(value);
  const comma = json.indexOf(",");
  stream.bytes(`data: ${json.slice(0, comma + 1)}\r`);
  stream.bytes(`\ndata: ${json.slice(comma + 1)}\r`);
  stream.bytes("\n\r");
  stream.bytes("\n");
  expect(await first.events.next()).toEqual(value);
  stream.bytes('data: {"invalid":true}\n\n');
  expect(await first.task.catch((error: unknown) => error)).toMatchObject({ name: "ZodError" });
});
