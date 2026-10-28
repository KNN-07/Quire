import { expect, test } from "bun:test";
import { z } from "zod";
import { ProjectSchema } from "@quire/contracts";
import { reviewFixture, sourceDoc, proposal, mutation } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("materializes pending suggestions into an independent copy without copying review chat ACL or history labels", async () => {
  // Given: an original project with pending tracked edits, comments, chat and a label.
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const original = (await fixture.service.loadDocument(scope, ids.mainFile));
  const doc = sourceDoc(original.state);
  const edit = proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 });
  const suggestion = await fixture.request(`/api/projects/${ids.project}/suggestions`,
    mutation(reviewer.headers, { scope, edits: [edit], expectedVersion: 0 }));
  const thread = await fixture.request(`/api/projects/${ids.project}/threads`,
    mutation(reviewer.headers, { scope, body: "Original review", expectedVersion: 0 }));
  const chat = await fixture.request(`/api/projects/${ids.project}/chat`,
    mutation(owner.headers, { scope, body: "Original chat", expectedVersion: 0 }));
  const label = await fixture.request(`/api/projects/${ids.project}/history/${ids.snapshot}/labels`,
    mutation(owner.headers, { name: "Original label", expectedVersion: 0 }));
  expect([suggestion.status, thread.status, chat.status, label.status]).toEqual([200, 200, 200, 200]);
  // When: the user creates a genuine project copy through its actual HTTP endpoint.
  const response = await fixture.request(`/api/projects/${ids.project}/copy`,
    mutation(owner.headers, { name: "Independent copy", expectedVersion: (await fixture.service.getProject(ids.project)).version }));
  const copied = z.object({ data: ProjectSchema }).parse(await response.json()).data;
  const copiedScope = { projectId: copied.id, branch: copied.defaultBranch };
  // Then: pending edits are materialized only in the copy, while identities and collaborative metadata are fresh.
  expect(copied.id).not.toBe(ids.project);
  expect(copied.settings.mainFileId).not.toBe(ids.mainFile);
  expect((await fixture.service.loadDocument(copiedScope, copied.settings.mainFileId)).text).toContain("{report}");
  expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toBe(original.text);
  const counts = z.object({ threads: z.number(), suggestions: z.number(), chat: z.number(), members: z.number(), labels: z.number() }).parse(
    (await fixture.runtime.db.get(`SELECT
      (SELECT count(*) FROM threads WHERE project_id=?) AS threads,
      (SELECT count(*) FROM suggestions WHERE project_id=?) AS suggestions,
      (SELECT count(*) FROM chat_messages WHERE project_id=?) AS chat,
      (SELECT count(*) FROM project_members WHERE project_id=?) AS members,
      (SELECT count(*) FROM version_labels l JOIN history_versions h ON h.id=l.history_version_id
        JOIN snapshots s ON s.id=h.snapshot_id WHERE s.project_id=?) AS labels`, [copied.id, copied.id, copied.id, copied.id, copied.id])));
  expect(counts).toEqual({ threads: 0, suggestions: 0, chat: 0, members: 0, labels: 0 });
  doc.destroy();
});
