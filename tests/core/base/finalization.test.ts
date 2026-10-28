import { expect, spyOn, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import { baseFixture, clock } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import type { SourceFinalization } from "../../../services/core/base";

test("dependent review statuses, response and events recover with the source transaction", async () => {
  await using fixture = await baseFixture();
  const scope = { projectId: ids.project, branch: "main" };
  const suggestionId = IdSchema.parse(crypto.randomUUID());
  const editId = IdSchema.parse(crypto.randomUUID());
  await fixture.runtime.uow.run(async tx => {
    await tx.run(`INSERT INTO suggestions(id,project_id,branch,author_id,origin,created_at)
      VALUES(?,?,'main',?,'human',?)`, [suggestionId, ids.project, ids.kien, clock.now()]);
    await tx.run(`INSERT INTO suggestion_edits
      (id,suggestion_id,file_id,anchor_json,before_text,after_text,base_revision,edit_order)
      VALUES(?,?,?,'{}','','accepted',0,0)`, [editId, suggestionId, ids.mainFile]);
  });
  const branch = await fixture.service.getBranch(scope);
  const files = await fixture.service.listFiles(scope);
  const document = await fixture.service.readDocument(scope, ids.mainFile);
  const sql = "UPDATE suggestion_edits SET status='accepted',version=version+1 WHERE id=? AND status='pending'";
  const finalization: SourceFinalization = {
    statements: [{ sqlite: sql, postgres: sql, parameters: [editId], changes: 1 }],
    receipts: [{ actorId: ids.kien, key: "dependent-decision", route: "review-test", digest: "decision-digest", response: '{"accepted":true}' }],
    events: [{ topic: "review.changed", aggregateId: ids.project, payload: { resourceId: suggestionId, version: 1 } }],
  };
  const fault = spyOn(fixture.runtime.events, "record").mockImplementationOnce(async () => {
    throw new Error("Crash after source, status and receipt writes before event commit");
  });
  try {
    const failed = await fixture.service.serialized(scope, lease => fixture.service.commitSource({
      actorId: ids.kien, scope, lease, expectedRevision: branch.revision, finalization,
      inputs: files.map(file => ({
        file, ...(file.id === ids.mainFile
          ? { bytes: new TextEncoder().encode(`${document.text}\n% accepted\n`) } : {})
      })),
    })).then(() => false, () => true);
    expect(failed).toBe(true);
  } finally { fault.mockRestore(); }
  expect(await fixture.runtime.db.get<{ status: string }>("SELECT status FROM suggestion_edits WHERE id=?", [editId])).toEqual({ status: "pending" });
  expect(await fixture.runtime.db.all("SELECT key FROM idempotency_results WHERE route='review-test'")).toHaveLength(0);
  expect((await fixture.service.getBranch(scope)).revision).toBe(branch.revision);
  await fixture.restart();
  expect(await fixture.runtime.db.get<{ status: string; version: number }>(
    "SELECT status,version FROM suggestion_edits WHERE id=?", [editId])).toEqual({ status: "accepted", version: 1 });
  expect(await fixture.runtime.db.all("SELECT key FROM idempotency_results WHERE route='review-test'")).toHaveLength(1);
  expect((await fixture.service.readDocument(scope, ids.mainFile)).text).toBe(`${document.text}\n% accepted\n`);
  const events = await fixture.runtime.events.read(0, { aggregateId: ids.project, limit: 200 });
  expect(events.filter(event => event.topic === "review.changed" && event.payload.resourceId === suggestionId)).toHaveLength(1);
  await fixture.restart();
  expect((await fixture.service.getBranch(scope)).revision).toBe(branch.revision + 1);
});
