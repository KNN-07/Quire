import { expect, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import { referenceBlob } from "@quire/runtime";
import { dropboxServer } from "./provider";
import { dropboxFixture, remotePath, scope } from "./harness";
import { localText } from "./local";

test("exports actual persisted compile artifacts only after generated output opt-in", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  const bytes = new TextEncoder().encode("persisted compiler artifact bytes");
  const blob = await harness.fixture.runtime.blobs.put(bytes);
  const snapshot = await harness.fixture.service.snapshot(harness.owner.user.id, scope,
    (await harness.fixture.service.getBranch(scope)).revision);
  const project = await harness.fixture.service.getProject(scope.projectId);
  const jobId = IdSchema.parse(crypto.randomUUID());
  await harness.fixture.runtime.uow.run(async tx => {
    await referenceBlob(tx, { digest: blob, bytes: bytes.length }, harness.fixture.clock);
    await tx.run(`INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,
      queued_at,finished_at,idempotency_key) VALUES(?,?,?,?,?,'succeeded',?,?,?)`,
    [jobId, harness.owner.user.id, snapshot.id, project.settings.environmentId, JSON.stringify(project.settings),
      harness.fixture.clock.now(), harness.fixture.clock.now(), crypto.randomUUID()]);
    await tx.run("INSERT INTO artifacts(id,job_id,name,mime,bytes,sha256,kind,created_at) VALUES(?,?,?,?,?,?,'pdf',?)",
      [crypto.randomUUID(), jobId, "output.pdf", "application/pdf", bytes.length, blob, harness.fixture.clock.now()]);
  });
  await harness.success("initialSync");
  const path = `.quire-generated/${jobId}/output.pdf`;
  expect(provider.text(remotePath(path))).toBeNull();
  // When
  const operation = await harness.success("sync", { parameters: { generatedOutput: true } });
  // Then
  expect(provider.text(remotePath(path))).toBe("persisted compiler artifact bytes");
  expect(operation.result?.["generatedOutput"]).toBe(true);
  expect(await localText(harness, path)).toBeNull();
});
