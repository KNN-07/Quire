import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, SuggestionSchema } from "@quire/contracts";
import { reviewFixture, proposal, sourceDoc, mutation } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("authorized sessions read persisted suggestion pages and decision filters after restart", async () => {
  // Given: two actual proposals and a separately authenticated viewer.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const outsider = await fixture.login("outsider@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const doc = sourceDoc((await fixture.service.loadDocument(scope, ids.mainFile)).state);
  const edits = [proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 })];
  doc.destroy();
  const created = [];
  for (let index = 0; index < 2; index++) {
    const response = await fixture.request(`/api/projects/${ids.project}/suggestions`,
      mutation(owner.headers, { scope, edits, expectedVersion: 0 }));
    created.push(z.object({ data: SuggestionSchema }).parse(await response.json()).data);
  }
  const first = created[0];
  if (!first) throw new TypeError("Expected persisted suggestion");
  await fixture.request(`/api/projects/${ids.project}/suggestions/decide`,
    mutation(owner.headers, { ids: [first.id], decision: "reject", expectedVersion: 0 }));
  await fixture.restart();
  // When: the viewer reads the persisted list, pages and selected edit status.
  const base = `/api/projects/${ids.project}/suggestions?branch=main`;
  const schema = z.object({ data: endpoints.suggestionsList.output });
  const pageOne = schema.parse(await (await fixture.request(`${base}&limit=1`, { headers: viewer.headers })).json()).data;
  const pageTwo = schema.parse(await (await fixture.request(`${base}&limit=1&cursor=${pageOne.nextCursor}`,
    { headers: viewer.headers })).json()).data;
  const rejected = schema.parse(await (await fixture.request(`${base}&fileId=${ids.mainFile}&status=rejected`,
    { headers: viewer.headers })).json()).data;
  // Then: stable pages retain exact proposals and current authorization controls access.
  expect([...pageOne.items, ...pageTwo.items].map(item => item.id)).toEqual(created.map(item => item.id).sort());
  expect(pageTwo.nextCursor).toBeNull();
  expect(rejected.items.map(item => item.id)).toEqual([first.id]);
  expect(rejected.items[0]?.edits[0]?.status).toBe("rejected");
  expect((await fixture.request(base, { headers: outsider.headers })).status).toBe(404);
  await fixture.runtime.db.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [ids.project, viewer.user.id]);
  expect((await fixture.request(base, { headers: viewer.headers })).status).toBe(404);
});
