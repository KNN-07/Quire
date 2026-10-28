import { expect, test } from "bun:test";
import { AiToolSchema } from "@quire/contracts";
import { referenceBlob } from "@quire/runtime";
import { defaultPreferences } from "../../../services/accounts/identity/store";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { newId } from "../../../services/adapters/ai/model";
import { aiFixture, failure } from "./harness";
import { providerServer } from "./provider";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==";

test("routes every advertised tool through a real configured HTTP completion", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await fixture.runtime.db.run("UPDATE preferences SET value_json=? WHERE user_id=?", [
    JSON.stringify({ ...defaultPreferences, inlineCompletion: true, citationWebSearch: true, citationProviders: ["crossref"] }), session.user.id]);
  const operator = await fixture.login("operator@quire.local");
  const configured = await fixture.request("/api/admin/providers/crossref", { method: "PUT",
    headers: { ...operator.headers, "if-match": '"0"' }, body: JSON.stringify({
      baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: 0,
    }) });
  expect(configured.status).toBe(200);
  const image = await fixture.ai.upload(session.actor, { projectId: project.id, mime: "image/png", dataBase64: png });
  const snapshot = await fixture.core.snapshot(session.user.id, scope, (await fixture.core.getBranch(scope)).revision);
  const log = new TextEncoder().encode("Unrelated private log\n! Undefined control sequence.\nTail not selected");
  const hash = await fixture.runtime.blobs.put(log);
  const jobId = newId(); const diagnosticId = newId();
  await fixture.runtime.uow.run(async tx => {
    await referenceBlob(tx, { digest: hash, bytes: log.length }, fixture.clock);
    await tx.run("INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,queued_at,idempotency_key) VALUES(?,?,?,?,?,'failed',?,?)",
      [jobId, session.user.id, snapshot.id, project.settings.environmentId, JSON.stringify(project.settings), fixture.clock.now(), crypto.randomUUID()]);
    await tx.run("INSERT INTO artifacts(id,job_id,name,mime,bytes,sha256,kind,created_at) VALUES(?,?,'compile.log','text/plain',?,?,'log',?)",
      [newId(), jobId, log.length, hash, fixture.clock.now()]);
    await tx.run("INSERT INTO diagnostics(id,job_id,severity,message,raw_start,raw_end) VALUES(?,?,'error','Undefined control sequence',22,51)", [diagnosticId, jobId]);
  });
  provider.respond(context => ({ text: "Done", patches: [], citations: context.tool === "citation-reviewer"
    ? [{ provider: "crossref", providerId: "10.1234/verified" }] : [] }));
  // When
  for (const tool of AiToolSchema.options) {
    const run = await fixture.run(session, { scope, mode: "ask", tool, prompt: `Task ${tool}`, fileIds: [],
      ...(tool.endsWith("-image") ? { imageUploadIds: [image.id] } : {}),
      ...(tool === "error-fix" ? { diagnosticId } : {}) });
    expect(run.status).toBe("succeeded");
    if (tool === "citation-reviewer") {
      expect(run.sources.map(source => source.providerId)).toEqual(["10.1234/verified"]);
      expect(await fixture.runtime.db.get("SELECT 1 FROM ai_run_provenance WHERE run_id=?", [run.id])).not.toBeNull();
    }
  }
  // Then
  expect(provider.received).toHaveLength(AiToolSchema.options.length);
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(AiToolSchema.options.length);
  expect(provider.contexts.find(context => context.tool === "error-fix")?.diagnostic)
    .toBe(`Undefined control sequence\n${new TextDecoder().decode(log.slice(22, 51))}`);
}, 30_000);

test.each([
  { tool: "inline-completion" as const, prompt: "Complete", code: "AI_INLINE_DISABLED" },
  { tool: "chat" as const, prompt: "x".repeat(262145), code: "AI_CONTEXT_TOO_LARGE" },
  { tool: "error-fix" as const, prompt: "Fix", code: "AI_DIAGNOSTIC_REQUIRED" },
])("rejects $code before charge", async ({ tool, prompt, code }) => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  // When
  const error = await failure(fixture.ai.create(session.actor, { key: crypto.randomUUID(), request: {
    scope, mode: "ask", tool, prompt, fileIds: [],
  } }));
  // Then
  expect(error.code).toBe(code);
  expect(provider.received).toHaveLength(0);
  expect(await fixture.ai.store.usage(session.actor, "2026-10")).toMatchObject({ used: 0, reserved: 0 });
});

test("rejects an image whose claimed MIME differs from its bytes", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  // When
  const error = await failure(fixture.ai.upload(session.actor, { projectId: project.id, mime: "image/jpeg", dataBase64: png }));
  // Then
  expect(error.code).toBe("AI_IMAGE_INVALID");
  expect(provider.received).toHaveLength(0);
});

test("rejects invented citations after dispatch without fabricating retrieval provenance", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  provider.respond({ text: "A paper", patches: [], citations: [{ provider: "dimensions", providerId: "invented" }] });
  // When
  const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "chat", prompt: "Find citation", fileIds: [] });
  // Then
  expect(run.status).toBe("failed");
  expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("AI_CITATION_UNVERIFIED");
  expect(run.sources).toHaveLength(0);
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(1);
});
