import { test, expect } from "bun:test";
import { SnapshotSchema, FileEntrySchema } from "@quire/contracts";
import { baseFixture, clock } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { git, repositoryPath } from "../../../services/core/base";
import { writeCheckpoint } from "../../../services/core/base/git-checkpoint";
import { materializeDocument } from "../../../services/core/base/source-records";

test("recovers a prepared source intent into one consistent checkpoint on restart", async () => {
  // Given: durable objects and a journal record at the crash boundary before hidden-ref publication.
  await using fixture = await baseFixture();
  const scope = { projectId: ids.project, branch: "main" };
  const branch = (await fixture.service.getBranch(scope));
  const previous = (await fixture.service.loadDocument(scope, ids.mainFile));
  const text = `${previous.text}\n% recovered 😀\n`;
  const bytes = new TextEncoder().encode(text);
  const blob = await fixture.runtime.blobs.put(bytes);
  const file = FileEntrySchema.parse({
    ...(await fixture.service.getFile(scope, ids.mainFile)),
    blob, bytes: bytes.length, version: { revision: branch.revision + 1, epoch: 0 }
  });
  const files = (await fixture.service.listFiles(scope)).map((entry) => entry.id === file.id ? file : entry);
  const checkpoint = await writeCheckpoint(fixture.service.context, ids.project, files);
  const snapshot = SnapshotSchema.parse({
    id: crypto.randomUUID(), scope, revision: branch.revision + 1,
    tree: checkpoint.tree, authorId: ids.kien, createdAt: clock.now(), reason: "checkpoint"
  });
  const intent = {
    snapshot, branchId: branch.id, previousRevision: branch.revision, files,
    documents: [materializeDocument({ file, text, previous })], commit: checkpoint.commit
  };
  (await fixture.runtime.uow.run(async (tx) => {
    await tx.lock("quire:accounts");

    (await tx.run(`INSERT INTO git_intents(id,project_id,branch,new_ref,tree,state,idempotency_key,created_at)
      VALUES(?,?,?,?,?,'prepared',?,?)`, [snapshot.id, ids.project, "main", checkpoint.commit, checkpoint.tree, "crash-boundary", clock.now()]));
    (await tx.run("INSERT INTO base_source_intents(id,payload_json) VALUES(?,?)", [snapshot.id, JSON.stringify(intent)]));

  }));
  // When: startup replays the unfinished journal.
  await fixture.restart();
  // Then: all observable source stores expose the same recovered revision.
  expect((await fixture.service.readDocument(scope, file.id)).text).toBe(text);
  expect((await fixture.service.getSnapshot(snapshot.id)).revision).toBe(branch.revision + 1);
  expect(await fixture.runtime.blobs.get(blob)).toEqual(bytes);
  expect(await git(repositoryPath(fixture.service.context, ids.project), ["show", `refs/quire/history/${snapshot.id}:main.tex`])).toBe(text.trim());
  expect((await fixture.runtime.db.get<{ state: string }>("SELECT state FROM git_intents WHERE id=?", [snapshot.id]))).toEqual({ state: "finalized" });
});
