import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { aiFixture, errorSchema } from "../harness";
import { calls, queryCall, searchProvider } from "./provider";

for (const boundary of ["session", "configuration", "cancel"] as const) {
  test(`${boundary} change before search prevents a second provider request`, async () => {
    await using provider = searchProvider();
    await using fixture = await aiFixture(provider.origin);
    const session = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(session);
    provider.respond(async () => {
      if (boundary === "session") {
        await fixture.runtime.db.run("UPDATE sessions SET expires_at=? WHERE id=?", ["2000-01-01T00:00:00.000Z", session.actor.sessionId]);
      } else if (boundary === "configuration") {
        const settings = await fixture.ai.store.services.configuration.get("ai");
        const operator = await fixture.login("operator@quire.local");
        const response = await fixture.request("/api/admin/providers/ai", {
          method: "PUT", headers: { ...operator.headers, "if-match": `"${settings.version}"` },
          body: JSON.stringify({ baseUrl: settings.baseUrl, model: settings.model, secret: "replacement-key",
            policy: settings.policy, expectedVersion: settings.version }),
        });
        expect(response.status).toBe(200);
      } else {
        const row = await fixture.runtime.db.get<{ id: string }>("SELECT id FROM ai_runs WHERE status='running'");
        const id = IdSchema.parse(row?.id);
        const current = await fixture.ai.get(session.actor, id);
        await fixture.ai.cancel(session.actor, { id, expectedVersion: current.version });
      }
      return calls(queryCall());
    });
    const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
      mode: "ask", tool: "chat", prompt: "Search", fileIds: [], projectSearch: true });
    expect(run.status).toBe("canceled");
    expect(provider.received).toHaveLength(1);
    expect(run.messages).toEqual([]);
  });
}

test("unsupported language tools reject project-search consent before dispatch", async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const response = await fixture.request(`/api/projects/${project.id}/ai/runs`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope: { projectId: project.id, branch: project.defaultBranch },
      mode: "ask", tool: "grammar", prompt: "Search", fileIds: [], projectSearch: true }),
  });
  expect(response.status).toBe(400);
  expect(errorSchema.parse(await response.json()).error.code).toBe("AI_PROJECT_SEARCH_UNSUPPORTED");
  expect(provider.received).toHaveLength(0);
});

for (const invalid of ["duplicate", "excessive", "aggregate"] as const) {
  test(`rejects ${invalid} model output before returning search context`, async () => {
    await using provider = searchProvider();
    await using fixture = await aiFixture(provider.origin);
    const session = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(session);
    provider.respond(() => invalid === "duplicate" ? calls(queryCall(), queryCall())
      : invalid === "excessive" ? calls(...[1, 2, 3, 4].map(id => queryCall(String(id))))
        : { ...calls(queryCall()), message: { content: "x".repeat(270000), tool_calls: [queryCall()] } });
    const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
      mode: "ask", tool: "chat", prompt: "Search", fileIds: [], projectSearch: true });
    expect(run.status).toBe("failed");
    expect(provider.received).toHaveLength(1);
    expect((await fixture.ai.get(session.actor, run.id)).errorCode)
      .toBe(invalid === "aggregate" ? "AI_CONTEXT_TOO_LARGE" : "AI_PROJECT_SEARCH_INVALID");
  });
}

for (const protectedContent of [false, true]) {
  test(protectedContent ? "protects provider credentials found in source" : "bounds result count and excerpts without splitting surrogate pairs", async () => {
    await using provider = searchProvider();
    await using fixture = await aiFixture(provider.origin);
    const session = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(session);
    const scope = { projectId: project.id, branch: project.defaultBranch };
    const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
    const text = protectedContent ? "document fixture-ai-key" : Array.from({ length: 14 }, () => `document ${"\u{1f600}".repeat(2048)}`).join("\n");
    await fixture.core.serialized(scope, lease => fixture.core.commitSource({
      actorId: session.user.id, scope, lease, expectedRevision: original.file.version.revision,
      inputs: [{ file: original.file, bytes: new TextEncoder().encode(text) }],
    }));
    const run = await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "Search", fileIds: [], projectSearch: true });
    if (protectedContent) {
      expect(run.status).toBe("failed");
      expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("PROVIDER_SECRET_LEAK");
      expect(provider.received).toHaveLength(1);
    } else {
      expect(run.status).toBe("succeeded");
      const message = provider.received[1]?.messages.find(item => item.role === "tool");
      const parsed = z.object({ hits: z.array(z.object({ text: z.string(), from: z.number(), to: z.number() })) })
        .parse(JSON.parse(z.string().parse(message?.content)));
      expect(parsed.hits).toHaveLength(10);
      for (const hit of parsed.hits) {
        expect(hit.text.length).toBeLessThanOrEqual(4096);
        expect(hit.text.isWellFormed()).toBe(true);
        expect(hit.text).toBe(text.slice(hit.from, hit.to));
      }
    }
  });
}
