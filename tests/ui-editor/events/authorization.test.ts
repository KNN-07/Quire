import { expect, test } from "bun:test";
import { createClient, IdSchema, resourceVersionTag } from "@quire/contracts";
import type { Event, Id } from "@quire/contracts";
import { loadEditorWorkspace } from "../../../apps/web/src/features/editor/shared";
import { reviewFixture, mutation } from "../../core/review/harness";
import { fixtureIds, defaultPolicy } from "../../fixtures/foundation";
import { Queue, subscription } from "./harness";

test("real actor and Viewer-token replacement reauthorizes history with the same injected client", async () => {
  await using fixture = await reviewFixture({ localOrigin: true });
  const owner = await fixture.login();
  const editor = await fixture.login("mai@quire.local");
  let session: Readonly<Record<string, string>> = owner.headers;
  const requests: { readonly cookie: string | null; readonly token: string | null }[] = [];
  const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(session)) headers.set(name, value);
    if (url.pathname === "/api/events") requests.push({ cookie: headers.get("cookie"), token: headers.get("x-project-token") });
    return fixture.request(url.pathname + url.search, { headers, signal: request.signal });
  } });
  await using proxyResource = { async [Symbol.asyncDispose]() { await proxy.stop(true); } };
  expect(proxyResource).toBeDefined();
  const client = createClient(proxy.url.origin);
  const route = { projectId: fixtureIds.project, branch: "main", page: "edit", shareToken: null } as const;
  const notification = (actor: Id, resourceId = IdSchema.parse(crypto.randomUUID())) => fixture.runtime.uow.run(tx => fixture.runtime.events.record(tx, {
    topic: "notification.created", aggregateId: actor, payload: { resourceId, version: 0 },
  }));
  const ownerHistory = await notification(owner.user.id);
  const editorHistory = await notification(editor.user.id);
  await fixture.runtime.events.dispatch();
  const ownerWorkspace = await loadEditorWorkspace(client, route);
  const ownerReceived: Event[] = [];
  const ownerReplayed = Promise.withResolvers<void>();
  const ownerLive = Promise.withResolvers<void>();
  const liveOwnerResource = IdSchema.parse(crypto.randomUUID());
  await using first = subscription({ client, headers: ownerWorkspace.requestHeaders,
    actorId: ownerWorkspace.access.actorId, receive: value => {
    ownerReceived.push(value);
    if (value.id === ownerHistory.id) ownerReplayed.resolve();
    if (value.topic === "notification.created" && value.payload.resourceId === liveOwnerResource) ownerLive.resolve();
  } });
  await first.opened;
  await ownerReplayed.promise;
  session = editor.headers;
  const editorWorkspace = await loadEditorWorkspace(client, route);
  expect(editorWorkspace.access.actorId).toBe(editor.user.id);
  expect(ownerWorkspace.access.actorId).toBe(owner.user.id);
  expect(editorWorkspace.requestHeaders).not.toBe(ownerWorkspace.requestHeaders);
  const editorReceived: Event[] = [];
  const editorReplayed = Promise.withResolvers<void>();
  const editorLive = Promise.withResolvers<void>();
  const liveEditorResource = IdSchema.parse(crypto.randomUUID());
  await using replacement = subscription({ client, headers: editorWorkspace.requestHeaders,
    actorId: editorWorkspace.access.actorId, receive: value => {
    editorReceived.push(value);
    if (value.id === editorHistory.id) editorReplayed.resolve();
    if (value.topic === "notification.created" && value.payload.resourceId === liveEditorResource) editorLive.resolve();
  } });
  await replacement.opened;
  await editorReplayed.promise;
  await notification(owner.user.id, liveOwnerResource);
  await notification(editor.user.id, liveEditorResource);
  await fixture.runtime.events.dispatch();
  await Promise.all([ownerLive.promise, editorLive.promise]);
  expect(ownerReceived.filter(value => value.topic === "notification.created").map(value => value.aggregateId))
    .toEqual([owner.user.id, owner.user.id]);
  expect(editorReceived.filter(value => value.topic === "notification.created").map(value => value.aggregateId))
    .toEqual([editor.user.id, editor.user.id]);
  expect(requests[0]?.cookie).toBe(owner.headers.cookie);
  expect(requests[1]?.cookie).toBe(editor.headers.cookie);
  // Actor metadata cannot join an old hub under replacement authentication.
  await using staleActor = subscription({ client, headers: { ...ownerWorkspace.requestHeaders },
    actorId: ownerWorkspace.access.actorId });
  expect(await staleActor.task.catch((error: unknown) => error)).toMatchObject({ code: "EVENT_AUTHORITY_CHANGED" });
  first.abort.abort();
  await first.task;
  expect(ownerReceived.filter(value => value.topic === "notification.created").every(value => value.aggregateId === owner.user.id)).toBe(true);

  await fixture.runtime.db.run("UPDATE organizations SET policy_json=?",
    [JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true })]);
  const other = await fixture.create(owner.headers);
  const viewerToken = async (projectId: Id) => {
    const version = (await fixture.service.getProject(projectId)).version;
    const response = await fixture.request(`/api/projects/${projectId}/link`, {
      ...mutation(owner.headers, { role: "viewer", expectedVersion: version }), method: "PUT",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": resourceVersionTag(version) },
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("data" in result)
      || !result.data || typeof result.data !== "object" || !("urlOnce" in result.data)
      || typeof result.data.urlOnce !== "string") throw new TypeError("Missing Viewer link");
    const token = new URL(result.data.urlOnce).searchParams.get("share");
    if (!token) throw new TypeError("Missing Viewer credential");
    return token;
  };
  const firstToken = await viewerToken(fixtureIds.project);
  const secondToken = await viewerToken(other.id);
  session = {};
  const firstViewer = await loadEditorWorkspace(client, { ...route, shareToken: firstToken });
  const secondViewer = await loadEditorWorkspace(client, { ...route, projectId: other.id, shareToken: secondToken });
  expect(firstViewer.access.actorId).toBeNull();
  expect(secondViewer.access.actorId).toBeNull();
  const firstEvents: Event[] = [];
  const secondEvents: Event[] = [];
  const firstSaved = new Queue<Event>();
  const secondSaved = new Queue<Event>();
  await using firstAnonymous = subscription({ client, headers: firstViewer.requestHeaders, actorId: null, receive: value => {
    firstEvents.push(value);
    firstSaved.push(value);
  } });
  await using secondAnonymous = subscription({ client, headers: secondViewer.requestHeaders, actorId: null, receive: value => {
    secondEvents.push(value);
    secondSaved.push(value);
  } });
  await Promise.all([firstAnonymous.opened, secondAnonymous.opened]);
  const firstSnapshot = await fixture.service.snapshot(owner.user.id, { projectId: fixtureIds.project, branch: "main" }, firstViewer.access.branchRevision);
  const secondSnapshot = await fixture.service.snapshot(owner.user.id, { projectId: other.id, branch: "main" }, secondViewer.access.branchRevision);
  const saved = async (queue: Queue<Event>, id: Id) => {
    for (;;) {
      const value = await queue.next();
      if (value.topic === "history.created" && value.payload.resourceId === id) return;
    }
  };
  await Promise.all([saved(firstSaved, firstSnapshot.id), saved(secondSaved, secondSnapshot.id)]);
  expect(firstEvents.every(value => value.aggregateId === fixtureIds.project)).toBe(true);
  expect(secondEvents.every(value => value.aggregateId === other.id)).toBe(true);
  expect(firstEvents.some(value => value.topic === "notification.created")).toBe(false);
  expect(secondEvents.some(value => value.topic === "notification.created")).toBe(false);
  expect(requests.some(value => value.cookie === null && value.token === firstToken)).toBe(true);
  expect(requests.some(value => value.cookie === null && value.token === secondToken)).toBe(true);
  console.info("P63_REAL_AUTHORIZATION", {
    owner: ownerWorkspace.access.actorId, replacement: editorWorkspace.access.actorId,
    ownerPrivate: ownerReceived.filter(value => value.topic === "notification.created").map(value => value.aggregateId),
    replacementPrivate: editorReceived.filter(value => value.topic === "notification.created").map(value => value.aggregateId),
    firstAnonymousProject: fixtureIds.project, secondAnonymousProject: other.id,
    firstAnonymousEvents: firstEvents.length, secondAnonymousEvents: secondEvents.length,
    independentAuthorizedRequests: requests.length,
  });
}, 120_000);
