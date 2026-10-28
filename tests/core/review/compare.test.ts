import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, ProposedEditSchema, FileEntrySchema } from "@quire/contracts";
import { reviewFixture, proposal, sourceDoc, mutation } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("compares real changed checkpoint content and retains intermediate authors between owner checkpoints", async () => {
  // Given: two immutable owner checkpoints with actual edits by different authors between them.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const before = (await fixture.service.loadDocument(scope, ids.mainFile));
  const from = await fixture.service.snapshot(owner.user.id, scope, 0);
  const original = sourceDoc(before.state);
  const first = ProposedEditSchema.parse({ ...proposal(original, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 }),
    id: crypto.randomUUID(), status: "pending" });
  await fixture.service.applyEdits(owner.user.id, scope, [first], "first-compare-edit");
  const edited = sourceDoc((await fixture.service.loadDocument(scope, ids.mainFile)).state);
  const second = ProposedEditSchema.parse({ ...proposal(edited, { fileId: ids.mainFile, before: "report", after: "book", baseRevision: 1 }),
    id: crypto.randomUUID(), status: "pending" });
  await fixture.service.applyEdits(ids.mai, scope, [second], "second-compare-edit");
  const to = await fixture.service.snapshot(owner.user.id, scope, 2);
  // When: HTTP compares the endpoints of that revision interval.
  const response = await fixture.request(`/api/projects/${ids.project}/history/compare?branch=main&from=${from.id}&to=${to.id}`,
    { headers: owner.headers });
  const result = z.object({ data: z.object({ files: z.array(z.object({ id: IdSchema })),
    hunks: z.array(z.object({ before: z.string(), after: z.string() })), authors: z.array(IdSchema) }) }).parse(await response.json()).data;
  // Then: the real source change is present and an intermediate author is not lost behind owner snapshots.
  expect(result.files.map(file => file.id)).toEqual([ids.mainFile]);
  expect(result.hunks).toEqual([{ before: before.text, after: before.text.replace("article", "book") }]);
  expect(new Set(result.authors)).toEqual(new Set([ids.kien, ids.mai]));
  original.destroy(); edited.destroy();
});

test("reports correct whole-file line coordinates when history compares a newly created file", async () => {
  // Given: a checkpoint before a genuine file creation and one after it.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const from = await fixture.service.snapshot(owner.user.id, scope, 0);
  const created = await fixture.request(`/api/projects/${ids.project}/files`,
    mutation(owner.headers, { scope, path: "new.tex", kind: "file", text: "first\nsecond\n", expectedVersion: 0 }));
  const file = z.object({ data: FileEntrySchema }).parse(await created.json()).data;
  const to = await fixture.service.snapshot(owner.user.id, scope, 1);
  // When: HTTP compares just the new file between those immutable versions.
  const response = await fixture.request(`/api/projects/${ids.project}/history/compare?branch=main&from=${from.id}&to=${to.id}&fileId=${file.id}`,
    { headers: owner.headers });
  const result = z.object({ data: z.object({ hunks: z.array(z.object({ before: z.string(), after: z.string(),
    oldStart: z.number(), oldLines: z.number(), newStart: z.number(), newLines: z.number() })) }) }).parse(await response.json()).data;
  // Then: an absent old file has zero lines and the two-line new file starts on line one.
  expect(result.hunks).toEqual([{ before: "", after: "first\nsecond\n", oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 }]);
});
