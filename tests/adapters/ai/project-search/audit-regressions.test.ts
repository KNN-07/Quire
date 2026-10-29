import { expect, test } from "bun:test";
import { z } from "zod";
import { aiFixture } from "../harness";
import { answer, calls, queryCall, searchProvider } from "./provider";

test("search excerpts contain matches beyond the first 4096 units of a line", async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  const query = "late-search-token";
  const text = `% preface\n${"\u{1f600}".repeat(2500)}${query} matched suffix`;
  await fixture.core.serialized(scope, lease => fixture.core.commitSource({
    actorId: session.user.id, scope, lease, expectedRevision: original.file.version.revision,
    inputs: [{ file: original.file, bytes: new TextEncoder().encode(text) }],
  }));
  provider.respond(request => request.messages.some(message => message.role === "tool")
    ? answer() : calls(queryCall("late", { query })));
  const run = await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "Locate late text", fileIds: [], projectSearch: true });
  expect(run.status).toBe("succeeded");
  const message = provider.received[1]?.messages.find(item => item.role === "tool");
  const parsed = z.object({ hits: z.array(z.object({ text: z.string(), from: z.number(), to: z.number() })) })
    .parse(JSON.parse(z.string().parse(message?.content)));
  expect(parsed.hits).toHaveLength(1);
  for (const hit of parsed.hits) {
    expect(hit.text).toContain(query);
    expect(hit.text).toBe(text.slice(hit.from, hit.to));
    expect(hit.text.length).toBeLessThanOrEqual(4096);
    expect(hit.text.isWellFormed()).toBe(true);
  }
});

test("protected credentials in returned filenames never reach provider or manifest", async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const query = "credential-path-search";
  const branch = await fixture.core.getBranch(scope);
  const created = await fixture.request(`/api/projects/${project.id}/files`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, path: "fixture-ai-key.tex", kind: "file", text: query, expectedVersion: branch.revision }),
  });
  expect(created.status).toBe(200);
  provider.respond(() => calls(queryCall("path", { query })));
  const run = await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "Locate context", fileIds: [], projectSearch: true });
  expect(run.status).toBe("failed");
  expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("PROVIDER_SECRET_LEAK");
  expect(provider.received).toHaveLength(1);
  const row = await fixture.runtime.db.get<{ manifest_json: string }>("SELECT manifest_json FROM ai_run_metadata WHERE run_id=?", [run.id]);
  expect(row?.manifest_json).not.toContain("fixture-ai-key");
});
