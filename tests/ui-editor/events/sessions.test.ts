import { access } from "node:fs/promises";
import { expect, test } from "bun:test";
import { createClient } from "@quire/contracts";
import type { Event, Id } from "@quire/contracts";
import { loadEditorWorkspace } from "../../../apps/web/src/features/editor/shared";
import { aiFixture } from "../../adapters/ai/harness";
import { providerServer } from "../../adapters/ai/provider";
import { subscription } from "./harness";
import type { Queue } from "./harness";

test("same-actor sessions cannot inherit private AI streams and revocation closes only the old session", async () => {
  const resources = new AsyncDisposableStack();
  let root: string | null = null;
  try {
    const provider = resources.use(providerServer());
    const fixture = resources.use(await aiFixture(provider.origin, { review: true }));
    root = fixture.path;
    const firstSession = await fixture.login();
    const secondSession = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(firstSession);
    expect(firstSession.user.id).toBe(secondSession.user.id);
    expect(firstSession.actor.sessionId).not.toBe(secondSession.actor.sessionId);
    expect(firstSession.headers["x-csrf-token"]).not.toBe(secondSession.headers["x-csrf-token"]);
    let session: Readonly<Record<string, string>> = firstSession.headers;
    const requests: string[] = [];
    const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const headers = new Headers(request.headers);
      for (const [name, value] of Object.entries(session)) headers.set(name, value);
      if (new URL(request.url).pathname === "/api/events") requests.push(headers.get("cookie") ?? "");
      return fixture.runtime.routes.fetch(new Request(request, { headers }));
    } });
    resources.defer(async () => { await proxy.stop(true); });
    const current = await fixture.request("/api/me", { headers: firstSession.headers });
    console.info("P63_SESSION_OWNED", { root, api: new URL(current.url).origin,
      proxy: proxy.url.origin, provider: provider.origin });
    await current.json();
    const client = createClient(proxy.url.origin);
    const route = { projectId: project.id, branch: project.defaultBranch, page: "edit", shareToken: null } as const;
    const firstWorkspace = await loadEditorWorkspace(client, route);
    const firstEvents: Event[] = [];
    const first = resources.use(subscription({ client, headers: firstWorkspace.requestHeaders,
      actorId: firstWorkspace.access.actorId, receive: value => { firstEvents.push(value); } }));
    const completed = async (events: Queue<Event>, id: Id) => {
      for (;;) {
        const value = await events.next();
        if (value.topic === "operation.changed" && value.aggregateId === id && value.payload.status === "succeeded") return;
      }
    };
    const run = (actor: typeof firstSession, prompt: string) => fixture.run(actor, {
      scope: { projectId: project.id, branch: project.defaultBranch },
      mode: "ask", tool: "chat", prompt, fileIds: [],
    });
    await first.opened;
    const firstRun = await run(firstSession, "First session private history");
    await completed(first.events, firstRun.id);

    session = secondSession.headers;
    const secondWorkspace = await loadEditorWorkspace(client, route);
    const secondEvents: Event[] = [];
    const second = resources.use(subscription({ client, headers: secondWorkspace.requestHeaders,
      actorId: secondWorkspace.access.actorId, receive: value => { secondEvents.push(value); } }));
    await second.opened;
    const secondRun = await run(secondSession, "Second session private history");
    await completed(second.events, secondRun.id);
    expect(secondEvents.some(value => value.aggregateId === firstRun.id)).toBe(false);
    expect(firstEvents.some(value => value.aggregateId === secondRun.id)).toBe(false);
    expect(requests).toEqual([firstSession.headers.cookie, secondSession.headers.cookie]);

    const refreshedWorkspace = await loadEditorWorkspace(client, route);
    const refreshedEvents: Event[] = [];
    const refreshed = resources.use(subscription({ client, headers: { ...refreshedWorkspace.requestHeaders },
      actorId: refreshedWorkspace.access.actorId, receive: value => { refreshedEvents.push(value); } }));
    await completed(refreshed.events, secondRun.id);
    expect(refreshedEvents.some(value => value.aggregateId === firstRun.id)).toBe(false);
    expect(secondEvents.filter(value => value.topic === "operation.changed"
      && value.aggregateId === secondRun.id && value.payload.status === "succeeded")).toHaveLength(1);
    const firstLive = await run(firstSession, "First session remains independently private");
    await completed(first.events, firstLive.id);
    const secondLive = await run(secondSession, "Second session live boundary");
    await Promise.all([completed(second.events, secondLive.id), completed(refreshed.events, secondLive.id)]);
    expect(secondEvents.some(value => value.aggregateId === firstLive.id)).toBe(false);
    expect(refreshedEvents.some(value => value.aggregateId === firstLive.id)).toBe(false);
    expect(firstEvents.some(value => value.aggregateId === secondLive.id)).toBe(false);

    const revokedFirst = first.task.catch((error: unknown) => error);
    expect((await fixture.request("/api/auth/logout", {
      method: "POST", headers: firstSession.headers, body: "{}",
    })).status).toBe(200);
    expect(await revokedFirst).toBeInstanceOf(TypeError);
    const afterRevocation = await run(secondSession, "New session survives old-session revocation");
    await Promise.all([completed(second.events, afterRevocation.id), completed(refreshed.events, afterRevocation.id)]);
    expect(firstEvents.some(value => value.aggregateId === afterRevocation.id)).toBe(false);

    const revokedSecond = second.task.catch((error: unknown) => error);
    const revokedRefresh = refreshed.task.catch((error: unknown) => error);
    expect((await fixture.request("/api/auth/logout", {
      method: "POST", headers: secondSession.headers, body: "{}",
    })).status).toBe(200);
    expect(await revokedSecond).toBeInstanceOf(TypeError);
    expect(await revokedRefresh).toBeInstanceOf(TypeError);
    session = {};
    const anonymous = resources.use(subscription({ client, headers: {}, actorId: null }));
    expect(await anonymous.task.catch((error: unknown) => error)).toMatchObject({ response: { status: 401 } });

    const thirdSession = await fixture.login();
    session = thirdSession.headers;
    expect(thirdSession.user.id).toBe(firstSession.user.id);
    expect(thirdSession.headers["x-csrf-token"]).not.toBe(secondSession.headers["x-csrf-token"]);
    expect(new Set([firstSession.headers["x-csrf-token"], secondSession.headers["x-csrf-token"],
      thirdSession.headers["x-csrf-token"]]).size).toBe(3);
    const thirdWorkspace = await loadEditorWorkspace(client, route);
    const thirdEvents: Event[] = [];
    const third = resources.use(subscription({ client, headers: thirdWorkspace.requestHeaders,
      actorId: thirdWorkspace.access.actorId, receive: value => { thirdEvents.push(value); } }));
    await third.opened;
    const thirdRun = await run(thirdSession, "Same actor after logout and login");
    await completed(third.events, thirdRun.id);
    const previous = new Set([firstRun.id, firstLive.id, secondRun.id, secondLive.id, afterRevocation.id]);
    expect(thirdEvents.some(value => previous.has(value.aggregateId))).toBe(false);
    expect((await fixture.request(`/api/ai/runs/${firstRun.id}`, { headers: thirdSession.headers })).status).toBe(404);
    expect((await fixture.request(`/api/ai/runs/${secondRun.id}`, { headers: thirdSession.headers })).status).toBe(404);
    expect(provider.received).toHaveLength(6);
    console.info("P63_SESSION_ISOLATION", {
      actor: firstSession.user.id,
      sessions: [firstSession.actor.sessionId, secondSession.actor.sessionId, thirdSession.actor.sessionId],
      csrfBoundariesDistinct: true, providerRequests: provider.received.length,
      oldSessionsRevoked: 2, privateHistoryLeaked: false, anonymousWithoutTokenStatus: 401,
    });
  } finally {
    await resources.disposeAsync();
    const absent = root === null || await access(root).then(() => false, () => true);
    console.info("P63_SESSION_CLEANUP", { root, absent, utc: new Date().toISOString() });
    expect(absent).toBe(true);
  }
}, 60_000);
