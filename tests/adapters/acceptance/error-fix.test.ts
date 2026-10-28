import { expect, test } from "bun:test";
import { AiRunSchema, CompileJobSchema, IdSchema } from "@quire/contracts";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { stopWorker } from "../../../services/compiler";
import { data, integrationFixture } from "../../integration/adapters/harness";
import { bounded } from "../../integration/portable/process";
import { providerServer } from "../ai/provider";

test("compiles an approved AI error fix using the actual failed job diagnostic without mutating source during inference", async () => {
  // Given: actual isolated TeX compilation, real core Git source, and a protocol provider.
  await using provider = providerServer();
  const http = new SafeHttpClient({ fixtureOrigins: [provider.origin] });
  await using fixture = await integrationFixture({ http, ai: { http } });
  const session = await fixture.login();
  const command = "\\p2xUndefinedCommand";
  const source = `\\documentclass{article}\n\\begin{document}\n${command}\nReviewed correction.\n\\end{document}\n`;
  const project = await fixture.core.createFromFiles(session.user.id, {
    name: "Independent error fix",
    entries: [{ path: "main.tex", bytes: new TextEncoder().encode(source) }],
  });
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const fileId = project.settings.mainFileId;
  await fixture.configure("ai", {
    baseUrl: `${provider.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
  });
  await fixture.runtime.uow.run(async tx => {
    await tx.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), project.id, JSON.stringify({ ...defaultPolicy, ai: "agent" }), fixture.clock.now()]);
    await tx.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify({ ...defaultPolicy, ai: "agent" }), session.user.id]);
    await tx.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'2026-10-27',1,?)",
      [session.user.id, fixture.clock.now()]);
  });
  async function compile() {
    const terminal = Promise.withResolvers<string>();
    const unsubscribe = fixture.runtime.events.subscribe(event => {
      if (event.topic === "job.changed" && event.aggregateId === project.id &&
        ["succeeded", "failed", "canceled"].includes(event.payload.status)) {
        terminal.resolve(IdSchema.parse(event.payload.resourceId));
      }
    });
    try {
      const created = await data(await fixture.request(`/api/projects/${project.id}/compiles`, {
        method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ scope, expectedRevision: (await fixture.core.getBranch(scope)).revision,
          settings: project.settings, clean: true }),
      }), CompileJobSchema);
      const completedId = await bounded(terminal.promise, 180_000);
      expect(completedId).toBe(created.id);
      return data(await fixture.request(`/api/compiles/${created.id}`, { headers: session.headers }), CompileJobSchema);
    } finally { unsubscribe(); }
  }
  await fixture.start();
  try {
    const failed = await compile();
    expect(failed.status).toBe("failed");
    const diagnostic = failed.diagnostics.find(item => item.severity === "error");
    if (!diagnostic) throw new TypeError("Actual failed compilation must return an error diagnostic");
    const log = await fixture.request(`/api/compiles/${failed.id}/log`, { headers: session.headers });
    expect(log.ok).toBe(true);
    const raw = new Uint8Array(await log.arrayBuffer());
    expect(raw.length).toBeGreaterThan(0);
    const expectedDiagnostic = `${diagnostic.message}\n${new TextDecoder().decode(
      raw.slice(diagnostic.rawStart, diagnostic.rawEnd))}`;
    provider.respond(context => ({
      text: "Remove the undefined control sequence", citations: [],
      patches: context.files.map(file => ({
        fileId: file.id, path: file.path, from: file.text.indexOf(command),
        to: file.text.indexOf(command) + command.length, before: command, after: "",
      })),
    }));
    const terminal = Promise.withResolvers<void>();
    const unsubscribe = fixture.runtime.events.subscribe(event => {
      if (event.topic === "operation.changed" &&
        ["succeeded", "failed", "canceled"].includes(event.payload.status)) terminal.resolve();
    });
    let generated;
    try {
      const created = await data(await fixture.request(`/api/projects/${project.id}/ai/runs`, {
        method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ scope, mode: "agent", tool: "error-fix",
          prompt: "Fix this selected compiler error", fileIds: [fileId], diagnosticId: diagnostic.id }),
      }), AiRunSchema);
      await bounded(terminal.promise, 20_000);
      generated = await data(await fixture.request(`/api/ai/runs/${created.id}`, { headers: session.headers }), AiRunSchema);
    } finally { unsubscribe(); }
    expect(generated.status).toBe("succeeded");
    expect(provider.contexts[0]?.diagnostic).toBe(expectedDiagnostic);
    expect((await fixture.core.readDocument(scope, fileId)).text).toBe(source);
    // When: the authorized actor explicitly approves the proposed correction.
    const accepted = await data(await fixture.request(`/api/ai/runs/${generated.id}/decide`, {
      method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: generated.version, editIds: [], decision: "accept" }),
    }), AiRunSchema);
    // Then: the new real snapshot compiles successfully and supplies a genuine PDF.
    expect(accepted.proposals[0]?.edits[0]?.status).toBe("accepted");
    expect((await fixture.core.readDocument(scope, fileId)).text).toBe(source.replace(command, ""));
    const corrected = await compile();
    expect(corrected.status).toBe("succeeded");
    expect(corrected.snapshot.id).not.toBe(failed.snapshot.id);
    expect(corrected.diagnostics.filter(item => item.severity === "error")).toEqual([]);
    const pdf = corrected.artifacts.find(item => item.kind === "pdf");
    if (!pdf) throw new TypeError("Successful recompilation must supply a real PDF");
    const response = await fixture.request(`/api/artifacts/${pdf.id}/content`, { headers: session.headers });
    expect(response.ok).toBe(true);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(pdf.sha256);
    expect(provider.received).toHaveLength(1);
    await fixture.runtime.repositories.assertReadable(project.id);
    console.info("P2X_ERROR_FIX_VERIFIED", { failedJob: failed.id, diagnostic: diagnostic.id,
      correctedJob: corrected.id, proposal: generated.id, snapshot: corrected.snapshot.id,
      pdfBytes: bytes.length, pdfSha256: pdf.sha256 });
  } finally { await stopWorker(fixture.runtime); }
}, 360_000);
