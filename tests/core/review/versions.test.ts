import { expect, test } from "bun:test";
import { z } from "zod";
import { ThreadSchema, CommentSchema, HistoryVersionSchema } from "@quire/contracts";
import { reviewFixture, mutation } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("reads a persisted comment counter after reload and uses it for a real edit precondition", async () => {
  // Given: a comment whose stored counter differs from the branch and creation defaults.
  await using fixture = await reviewFixture();
  const author = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const created = await fixture.request(`/api/projects/${ids.project}/threads`,
    mutation(author.headers, { scope, body: "Initial", expectedVersion: 0 }));
  const thread = z.object({ data: ThreadSchema }).parse(await created.json()).data;
  const comment = thread.comments[0];
  if (!comment) throw new TypeError("Expected comment");
  (await fixture.runtime.db.run("UPDATE comments SET version=7 WHERE id=?", [comment.id]));
  const reloaded = await fixture.request(`/api/projects/${ids.project}/threads/${thread.id}?branch=main`, { headers: author.headers });
  const current = z.object({ data: ThreadSchema }).parse(await reloaded.json()).data.comments[0];
  if (!current) throw new TypeError("Expected persisted comment");
  // When: the client edits using exactly the precondition returned after reload.
  const edited = await fixture.request(`/api/projects/${ids.project}/comments/${current.id}`, {
    method: "PATCH", headers: author.headers, body: JSON.stringify({ body: "Edited", expectedVersion: current.version }),
  });
  // Then: the actual counter advances; serializing a fabricated zero would make the mutation stale.
  expect(current.version).toBe(7);
  expect(edited.status).toBe(200);
  expect(z.object({ data: CommentSchema }).parse(await edited.json()).data).toMatchObject({ body: "Edited", version: 8 });
});

test("exposes the label aggregate counter rather than the source revision", async () => {
  // Given: a persisted label aggregate with a counter distinct from source revision zero.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const first = await fixture.request(`/api/projects/${ids.project}/history?branch=main`, { headers: owner.headers });
  const version = z.object({ data: z.object({ items: z.array(HistoryVersionSchema) }) }).parse(await first.json()).data.items[0];
  if (!version) throw new TypeError("Expected immutable history");
  (await fixture.runtime.db.run("UPDATE history_versions SET version=7 WHERE id=?", [version.id]));
  const reload = await fixture.request(`/api/projects/${ids.project}/history?branch=main`, { headers: owner.headers });
  const current = z.object({ data: z.object({ items: z.array(HistoryVersionSchema) }) }).parse(await reload.json()).data.items[0];
  if (!current) throw new TypeError("Expected persisted history counter");
  // When: a label mutation uses the returned aggregate counter.
  const labelled = await fixture.request(`/api/projects/${ids.project}/history/${current.id}/labels`,
    mutation(owner.headers, { name: "Counter checked", expectedVersion: current.version }));
  // Then: labels advance independently while immutable source stays at its original revision.
  expect(labelled.status).toBe(200);
  const result = z.object({ data: HistoryVersionSchema }).parse(await labelled.json()).data;
  expect(result.version).toBe(8);
  expect(result.snapshot.revision).toBe(0);
});
