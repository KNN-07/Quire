import { expect, test } from "bun:test";
import { AiRunSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { providerServer } from "../../adapters/ai/provider";
import { bounded } from "../portable/process";
import { data, integrationFixture } from "./harness";

test("leaves source unchanged until an authorized AI approval and retains the accepted real Git source after restart", async () => {
  // Given
  await using provider = providerServer();
  const http = new SafeHttpClient({ fixtureOrigins: [provider.origin] });
  await using fixture = await integrationFixture({ http, ai: { http } });
  const session = await fixture.login();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  await fixture.configure("ai", { baseUrl: `${provider.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key" });
  await fixture.runtime.uow.run(async tx => {
    await tx.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), project.id, JSON.stringify({ ...defaultPolicy, ai: "agent" }), fixture.clock.now()]);
    await tx.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify({ ...defaultPolicy, ai: "agent" }), session.user.id]);
    await tx.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'2026-10-27',1,?)",
      [session.user.id, fixture.clock.now()]);
  });
  provider.respond(context => ({ text: "Reviewed", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% composed approval\n",
  })) }));
  const terminal = Promise.withResolvers<void>();
  const unsubscribe = fixture.runtime.events.subscribe(event => {
    if (event.topic === "operation.changed" && ["succeeded", "failed", "canceled"].includes(event.payload.status)) terminal.resolve();
  });
  try {
    const created = await data(await fixture.request(`/api/projects/${project.id}/ai/runs`, {
      method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, mode: "agent", tool: "texgpt", prompt: "Insert a comment", fileIds: [original.file.id] }),
    }), AiRunSchema);
    await bounded(terminal.promise, 20_000);
    const generated = await data(await fixture.request(`/api/ai/runs/${created.id}`, { headers: session.headers }), AiRunSchema);
    expect(generated.status).toBe("succeeded");
    expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
    // When
    const accepted = await data(await fixture.request(`/api/ai/runs/${generated.id}/decide`, {
      method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: generated.version, editIds: [], decision: "accept" }),
    }), AiRunSchema);
    await fixture.restart();
    // Then
    expect(accepted.proposals[0]?.edits[0]?.status).toBe("accepted");
    expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(`% composed approval\n${original.text}`);
    expect(provider.received).toHaveLength(1);
    await fixture.runtime.repositories.assertReadable(project.id);
  } finally { unsubscribe(); }
}, 40_000);
