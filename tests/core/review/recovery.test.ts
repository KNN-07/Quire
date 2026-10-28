import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { SuggestionSchema, endpoints } from "@quire/contracts";
import { dispose } from "../../../services/core/review";
import { reviewFixture, proposal, sourceDoc, mutation, peer, bounded } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("recovers accepted review metadata and the HTTP replay receipt after source commit interruption", async () => {
  // Given: a real pending suggestion and a durable decision intent whose consumer stops.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const doc = sourceDoc((await fixture.service.loadDocument(scope, ids.mainFile)).state);
  const edit = proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 });
  const created = await fixture.request(`/api/projects/${ids.project}/suggestions`,
    mutation(reviewer.headers, { scope, edits: [edit], expectedVersion: 0 }));
  const suggestion = z.object({ data: SuggestionSchema }).parse(await created.json()).data;
  const key = "interrupted-acceptance";
  const body = { ids: [suggestion.id], decision: "accept", expectedVersion: 0 };
  const input = endpoints.suggestionDecide.input.parse({ params: { p: ids.project }, query: {}, body,
    headers: { "idempotency-key": key } });
  const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
  const sourceKey = `review-decision:${key}:${digest}`;
  const route = `suggestionDecide:${ids.project}:main`;
  (await fixture.runtime.db.run("INSERT INTO review_decision_intents(id,payload_json) VALUES(?,?)", [`${owner.user.id}:${route}:${key}`, JSON.stringify({ actorId: owner.user.id, scope,
      ids: [suggestion.id], editIds: suggestion.edits.map(item => item.id), key, route, digest, sourceKey })]));
  await dispose(fixture.runtime);
  await fixture.service.applyEdits(owner.user.id, scope, suggestion.edits, sourceKey);
  expect((await fixture.runtime.db.get<{ status: string }>("SELECT status FROM suggestion_edits WHERE suggestion_id=?", [suggestion.id]))?.status).toBe("pending");
  // When: registration recovers after the durable source receipt, before a retried HTTP decision.
  await fixture.restart();
  const retried = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": key }, body: JSON.stringify(body),
  });
  // Then: accepted metadata and replay are recovered without applying the source change again.
  expect(retried.status).toBe(200);
  const result = z.object({ data: z.array(SuggestionSchema) }).parse(await retried.json()).data;
  expect(result[0]?.edits[0]?.status).toBe("accepted");
  expect((await fixture.service.getBranch(scope)).revision).toBe(1);
  expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toContain("{report}");
  expect((await fixture.runtime.db.get<{ n: number }>("SELECT count(*) AS n FROM review_decision_intents", []))?.n).toBe(0);
  doc.destroy();
});

test("rolls back source, selected status, decision receipt and events at the finalization barrier and recovers together", async () => {
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const source = await fixture.service.loadDocument(scope, ids.mainFile);
  const doc = sourceDoc(source.state);
  try {
    const edit = proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 });
    const created = await fixture.request(`/api/projects/${ids.project}/suggestions`,
      mutation(reviewer.headers, { scope, edits: [edit], expectedVersion: 0 }));
    const suggestion = z.object({ data: SuggestionSchema }).parse(await created.json()).data;
    await using client = await peer(fixture.url, scope, owner.headers);
    const synced = client.next(message => message.type === "update");
    client.send({ type: "sync", fileId: ids.mainFile, epoch: source.epoch, stateVectorBase64: source.vector });
    await synced;
    const cursor = (await fixture.runtime.events.read(0, { limit: 1000 })).at(-1)?.seq ?? 0;
    const response = await fixture.request(`/api/events?after=${cursor}`, { headers: owner.headers });
    const reader = response.body?.getReader();
    if (!reader) throw new TypeError("Missing real SSE reader");
    try {
      let ready = "";
      while (!ready.includes(": ready")) {
        const part = await reader.read();
        if (part.done) throw new TypeError("SSE ended before subscription barrier");
        ready += new TextDecoder().decode(part.value);
      }
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const record = fixture.runtime.events.record.bind(fixture.runtime.events);
      const fault = spyOn(fixture.runtime.events, "record").mockImplementation(async (tx, event) => {
        if (event.topic === "review.changed") {
          entered.resolve();
          await release.promise;
          throw new Error("P1S_REVIEW_FINALIZATION_CRASH");
        }
        return record(tx, event);
      });
      const key = "p1s-atomic-acceptance";
      const decision = { method: "POST", headers: { ...owner.headers, "idempotency-key": key },
        body: JSON.stringify({ ids: [suggestion.id], decision: "accept", expectedVersion: 0 }) };
      try {
        const pending = fixture.request(`/api/projects/${ids.project}/suggestions/decide`, decision);
        await bounded(entered.promise);
        expect(client.messages.filter(message => message.type === "update" && message.revision > 0)).toEqual([]);
        release.resolve();
        expect((await pending).status).toBe(500);
      } finally {
        release.resolve();
        fault.mockRestore();
      }
      expect((await fixture.service.getBranch(scope)).revision).toBe(0);
      expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toBe(source.text);
      expect(await fixture.runtime.db.get<{ status: string }>("SELECT status FROM suggestion_edits WHERE suggestion_id=?", [suggestion.id]))
        .toEqual({ status: "pending" });
      expect(await fixture.runtime.db.get("SELECT 1 FROM idempotency_results WHERE actor_id=? AND key=?", [owner.user.id, key])).toBeNull();
      expect(await fixture.runtime.events.read(cursor)).toEqual([]);
      await reader.cancel();
      await fixture.restart();
      const retried = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`, decision);
      expect(retried.status).toBe(200);
      expect(z.object({ data: z.array(SuggestionSchema) }).parse(await retried.json()).data[0]?.edits[0]?.status).toBe("accepted");
      expect((await fixture.service.getBranch(scope)).revision).toBe(1);
      expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toContain("{report}");
      expect(await fixture.runtime.db.all("SELECT id FROM review_decision_intents")).toEqual([]);
      const committed = await fixture.runtime.events.read(cursor);
      expect(committed.filter(event => event.topic === "review.changed")).toHaveLength(1);
      expect(committed.filter(event => event.topic === "tree.changed")).toHaveLength(1);
      expect(committed.filter(event => event.topic === "document.saved")).toHaveLength(1);
    } finally { await reader.cancel(); }
  } finally { doc.destroy(); }
});
