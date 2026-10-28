import { expect, test } from "bun:test";
import { z } from "zod";
import * as Y from "yjs";
import { endpoints, IdSchema } from "@quire/contracts";
import { reviewFixture, peer, sourceDoc, bounded } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { applyBillingTransition } from "../../../services/accounts/governance";

async function stream(app: Awaited<ReturnType<typeof reviewFixture>>, headers: Record<string, string>, after: number) {
  const response = await app.request(`/api/events?after=${after}`, { headers });
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("SSE body missing");
  const through = async (marker: string) => {
    let text = "";
    while (!text.includes(marker)) {
      const part = await bounded(reader.read());
      if (part.done) throw new TypeError("SSE closed before its barrier");
      text += new TextDecoder().decode(part.value);
    }
    return text;
  };
  await through(": ready\n\n");
  return { through, [Symbol.asyncDispose]: () => reader.cancel() };
}
test("delivers owner seat-loss invalidation and denies the next already-open socket write", async () => {
  // Given: a collaborator SSE/WS and an unrelated reader's separate project stream.
  await using app = await reviewFixture();
  const editor = await app.login("mai@quire.local");
  const outsider = await app.login("outsider@quire.local");
  const operator = await app.login("operator@quire.local");
  const owner = await app.login();
  for (const [scope, benefits] of [
    ["deployment/local", { compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false }],
    ["plan/manual:licensed-owner", { compileSeconds: 90, writableMembers: 3, historyDays: null, trackChanges: true }],
  ] as const) expect((await app.request(`/api/admin/project-benefits/${scope}`, {
    method: "PUT", headers: operator.headers, body: JSON.stringify({ expectedVersion: 0, benefits }),
  })).status).toBe(200);
  const principal = await app.runtime.services.get("identity").require(new Request(app.url, { headers: operator.headers }));
  await applyBillingTransition(app.service.context, principal, { organizationId: ids.team, expectedVersion: 0,
    provider: "manual", planId: "licensed-owner", period: "month", seats: 3, status: "active", renewsAt: null });
  const otherProject = await app.create(outsider.headers);
  const scope = { projectId: ids.project, branch: "main" };
  const source = await app.service.loadDocument(scope, ids.mainFile);
  const cursor = Math.max(0, ...(await app.runtime.events.read(0, { limit: 1000 })).map(event => event.seq));
  await using editorEvents = await stream(app, editor.headers, cursor);
  await using unrelatedEvents = await stream(app, outsider.headers, cursor);
  await using socket = await peer(app.url, scope, editor.headers);
  const synced = socket.next(message => message.type === "update");
  socket.send({ type: "sync", fileId: ids.mainFile, epoch: source.epoch, stateVectorBase64: source.vector });
  await synced;
  const invalidated = editorEvents.through('"topic":"policy.changed"');
  const membership = z.object({ id: IdSchema, version: z.number() }).parse(await app.runtime.db.get(
    "SELECT id,version FROM members WHERE organization_id=? AND user_id=?", [ids.team, ids.kien]));
  // When: actual seat withdrawal removes the owner's mapped sponsorship from existing projects.
  const changed = await app.request(`/api/organizations/${ids.team}/members/${membership.id}`, {
    method: "PATCH", headers: owner.headers, body: JSON.stringify({ role: "admin", licensed: false, expectedVersion: membership.version }),
  });
  expect(changed.status).toBe(200);
  expect(await invalidated).toContain(ids.project);
  const current = await app.request(`/api/projects/${ids.project}/effective-access?branch=main`, { headers: editor.headers });
  expect(z.object({ data: endpoints.projectAccess.output }).parse(await current.json()).data)
    .toMatchObject({ role: "editor", effectiveRole: "viewer", capabilities: { edit: false, compile: false } });
  const doc = sourceDoc(source.state);
  try {
    doc.getText("source").insert(doc.getText("source").length, "\n% forbidden after benefit loss\n");
    const denied = socket.next(message => message.type === "error");
    socket.send({ type: "update", fileId: ids.mainFile, epoch: source.epoch, clientId: IdSchema.parse(crypto.randomUUID()),
      clientSeq: 1, updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") });
    // Then: the current authorization boundary refuses mutation without advancing source.
    expect(await denied).toMatchObject({ type: "error", code: "FORBIDDEN" });
    expect((await app.service.getBranch(scope)).revision).toBe(0);
    expect((await app.service.loadDocument(scope, ids.mainFile)).text).toBe(source.text);
    const otherScope = { projectId: otherProject.id, branch: "main" };
    const checkpoint = await app.service.snapshot(outsider.user.id, otherScope, (await app.service.getBranch(otherScope)).revision);
    const unrelated = await unrelatedEvents.through(checkpoint.id);
    expect(unrelated).not.toContain(ids.project);
    const invalidations = (await app.runtime.events.read(cursor, { aggregateId: ids.project, limit: 1000 }))
      .filter(event => event.topic === "policy.changed");
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0]?.payload.resourceId).toBe(ids.project);
  } finally { doc.destroy(); }
});
