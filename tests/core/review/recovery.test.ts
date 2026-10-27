import { expect, test } from "bun:test";
import { z } from "zod";
import { SuggestionSchema, endpoints } from "@quire/contracts";
import { dispose } from "../../../services/core/review";
import { reviewFixture, proposal, sourceDoc, mutation } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("recovers accepted review metadata and the HTTP replay receipt after source commit interruption", async () => {
  // Given: a real pending suggestion and a durable decision intent whose consumer stops.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const doc = sourceDoc(fixture.service.loadDocument(scope, ids.mainFile).state);
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
  fixture.runtime.db.query("INSERT INTO review_decision_intents(id,payload_json) VALUES(?,?)")
    .run(`${owner.user.id}:${route}:${key}`, JSON.stringify({ actorId: owner.user.id, scope,
      ids: [suggestion.id], editIds: suggestion.edits.map(item => item.id), key, route, digest, sourceKey }));
  dispose(fixture.runtime);
  await fixture.service.applyEdits(owner.user.id, scope, suggestion.edits, sourceKey);
  expect(fixture.runtime.db.query<{ status: string }, [string]>(
    "SELECT status FROM suggestion_edits WHERE suggestion_id=?").get(suggestion.id)?.status).toBe("pending");
  // When: registration recovers after the durable source receipt, before a retried HTTP decision.
  await fixture.restart();
  const retried = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": key }, body: JSON.stringify(body),
  });
  // Then: accepted metadata and replay are recovered without applying the source change again.
  expect(retried.status).toBe(200);
  const result = z.object({ data: z.array(SuggestionSchema) }).parse(await retried.json()).data;
  expect(result[0]?.edits[0]?.status).toBe("accepted");
  expect(fixture.service.getBranch(scope).revision).toBe(1);
  expect(fixture.service.loadDocument(scope, ids.mainFile).text).toContain("{report}");
  expect(fixture.runtime.db.query<{ n: number }, []>("SELECT count(*) AS n FROM review_decision_intents").get()?.n).toBe(0);
  doc.destroy();
});
