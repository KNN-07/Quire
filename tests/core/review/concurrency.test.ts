import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { SuggestionSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { bounded, mutation, proposal, reviewFixture, sourceDoc } from "./harness";

test("reserves review decisions durably across independent runtimes before source publication", async () => {
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const doc = sourceDoc((await fixture.service.loadDocument(scope, ids.mainFile)).state);
  try {
    const edits = [proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 })];
    const response = await fixture.request(`/api/projects/${ids.project}/suggestions`,
      mutation(owner.headers, { scope, edits, expectedVersion: 0 }));
    const suggestion = z.object({ data: SuggestionSchema }).parse(await response.json()).data;
    await using replica = await fixture.replica();
    expect(replica.runtime.db).not.toBe(fixture.runtime.db);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const apply = fixture.service.applyEdits.bind(fixture.service);
    const pause = spyOn(fixture.service, "applyEdits").mockImplementation(async (...args) => {
      entered.resolve();
      await bounded(release.promise);
      return apply(...args);
    });
    try {
      const accept = mutation(owner.headers, { ids: [suggestion.id], decision: "accept", expectedVersion: 0 });
      const pending = fixture.request(`/api/projects/${ids.project}/suggestions/decide`, accept);
      await bounded(entered.promise);
      const competing = await replica.request(`/api/projects/${ids.project}/suggestions/decide`,
        mutation(owner.headers, { ids: [suggestion.id], decision: "reject", expectedVersion: 0 }));
      expect(competing.status).toBe(409);
      expect(z.object({ error: z.object({ code: z.string() }) }).parse(await competing.json()).error.code).toBe("DECISION_BUSY");
      expect((await fixture.service.getBranch(scope)).revision).toBe(0);
      expect(await fixture.runtime.db.get<{ status: string }>("SELECT status FROM suggestion_edits WHERE suggestion_id=?", [suggestion.id]))
        .toEqual({ status: "pending" });
      release.resolve();
      const decided = await pending;
      expect(decided.status).toBe(200);
      const accepted = z.object({ data: z.array(SuggestionSchema) }).parse(await decided.json()).data;
      expect(accepted[0]?.edits[0]?.status).toBe("accepted");
      const replay = await replica.request(`/api/projects/${ids.project}/suggestions/decide`, accept);
      expect(z.object({ data: z.array(SuggestionSchema) }).parse(await replay.json()).data).toEqual(accepted);
      expect((await fixture.service.getBranch(scope)).revision).toBe(1);
      expect(await fixture.runtime.db.all("SELECT id FROM review_decision_intents")).toEqual([]);
    } finally {
      release.resolve();
      pause.mockRestore();
    }
  } finally { doc.destroy(); }
});
