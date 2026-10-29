import { expect, test } from "bun:test";
import { referenceBlob } from "@quire/runtime";
import { newId } from "../../../services/adapters/ai/model";
import { aiFixture, errorSchema } from "./harness";
import { providerServer } from "./provider";

test.each([{ stale: false }, { stale: true }])("binds diagnostic context to its compile revision (stale=$stale)", async ({ stale }) => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const document = await fixture.core.readDocument(scope, project.settings.mainFileId);
  const snapshot = await fixture.core.snapshot(session.user.id, scope, (await fixture.core.getBranch(scope)).revision);
  const log = new TextEncoder().encode("! Undefined control sequence.");
  const hash = await fixture.runtime.blobs.put(log);
  const jobId = newId();
  const diagnosticId = newId();
  await fixture.runtime.uow.run(async tx => {
    await referenceBlob(tx, { digest: hash, bytes: log.length }, fixture.clock);
    await tx.run("INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,queued_at,idempotency_key) VALUES(?,?,?,?,?,'failed',?,?)",
      [jobId, session.user.id, snapshot.id, project.settings.environmentId, JSON.stringify(project.settings), fixture.clock.now(), crypto.randomUUID()]);
    await tx.run("INSERT INTO artifacts(id,job_id,name,mime,bytes,sha256,kind,created_at) VALUES(?,?,'compile.log','text/plain',?,?,'log',?)",
      [newId(), jobId, log.length, hash, fixture.clock.now()]);
    await tx.run("INSERT INTO diagnostics(id,job_id,severity,message,raw_start,raw_end) VALUES(?,?,'error','Undefined control sequence',0,?)",
      [diagnosticId, jobId, log.length]);
  });
  if (stale) {
    const mutation = await fixture.request(`/api/projects/${project.id}/files`, {
      method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, path: "collaborator.tex", kind: "file", text: "New collaborator source",
        expectedVersion: snapshot.revision }),
    });
    expect(mutation.status).toBe(200);
    expect((await fixture.core.getBranch(scope)).revision).toBeGreaterThan(snapshot.revision);
  }
  const request = { scope, mode: "ask" as const, tool: "error-fix" as const, prompt: "Explain the error",
    fileIds: [document.file.id], diagnosticId };
  if (stale) {
    const response = await fixture.request(`/api/projects/${project.id}/ai/runs`, {
      method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(409);
    expect(errorSchema.parse(await response.json()).error.code).toBe("AI_DIAGNOSTIC_STALE");
    expect(provider.received).toHaveLength(0);
    expect(await fixture.ai.store.usage(session.actor, "2026-10")).toMatchObject({ used: 0, reserved: 0 });
  } else {
    const run = await fixture.run(session, request);
    expect(run.status).toBe("succeeded");
    expect(provider.contexts).toHaveLength(1);
    expect(provider.contexts[0]?.files).toEqual([
      { id: document.file.id, path: document.file.path, from: 0, to: document.text.length, text: document.text },
    ]);
    expect(provider.contexts[0]?.diagnostic).toBe(`Undefined control sequence\n${new TextDecoder().decode(log)}`);
  }
  console.info("DIAGNOSTIC_REVISION_CHECK", { stale, root: fixture.path, snapshotRevision: snapshot.revision });
}, 30_000);
