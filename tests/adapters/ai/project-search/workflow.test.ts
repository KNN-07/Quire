import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { aiFixture } from "../harness";
import { answer, calls, queryCall, searchProvider } from "./provider";

const results = z.object({ hits: z.array(z.object({
  fileId: IdSchema, path: z.string(), from: z.number(), to: z.number(), text: z.string(),
})) });

test("model-requested search returns only actual project excerpts and records consulted files without raw private content", async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const foreign = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  const run = await fixture.run(session, {
    scope, mode: "ask", tool: "chat", prompt: "private-search-canary", fileIds: [], projectSearch: true,
  });
  expect(run.status).toBe("succeeded");
  expect(provider.received).toHaveLength(2);
  const message = provider.received[1]?.messages.find(item => item.role === "tool");
  expect(message?.tool_call_id).toBe("search-1");
  const found = results.parse(JSON.parse(z.string().parse(message?.content)));
  expect(found.hits.length).toBeGreaterThan(0);
  for (const hit of found.hits) {
    expect(hit.fileId).toBe(project.settings.mainFileId);
    expect(hit.fileId).not.toBe(foreign.settings.mainFileId);
    expect(hit.text).toBe(original.text.slice(hit.from, hit.to));
  }
  const metadata = await fixture.runtime.db.get<{ manifest_json: string; request_json: string; context_digest: string }>(
    "SELECT manifest_json,request_json,context_digest FROM ai_run_metadata WHERE run_id=?", [run.id]);
  expect(JSON.parse(metadata?.manifest_json ?? "null")).toEqual([{ id: original.file.id, path: original.file.path }]);
  expect(metadata?.request_json).not.toContain("private-search-canary");
  expect(metadata?.request_json).not.toContain(original.text);
  expect(metadata?.context_digest).toMatch(/^[a-f0-9]{64}$/);
  expect((await fixture.ai.store.usage(session.actor, "2026-10")).used).toBe(1);
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
});

test("without search opt-in no tools are advertised and unsolicited calls cannot execute", async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  provider.respond(() => answer());
  expect((await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "No search", fileIds: [] })).status).toBe("succeeded");
  expect(provider.received[0]?.tools).toBeUndefined();
  provider.respond(() => calls(queryCall()));
  const run = await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "Still no search", fileIds: [] });
  expect(run.status).toBe("failed");
  expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("AI_TOOL_UNEXPECTED");
  expect(provider.received).toHaveLength(2);
});

for (const [name, call] of [
  ["authority arguments", queryCall("escape", { query: "document", projectId: crypto.randomUUID(), branch: "secret" })],
  ["unknown function", queryCall("escape", { query: "document" }, "read_file")],
  ["empty query", queryCall("empty", { query: "" })],
  ["oversized query", queryCall("huge", { query: "x".repeat(1001) })],
] as const) {
  test(`rejects ${name} without a second provider disclosure`, async () => {
    await using provider = searchProvider();
    await using fixture = await aiFixture(provider.origin);
    const session = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(session);
    provider.respond(() => calls(call));
    const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
      mode: "ask", tool: "chat", prompt: "Search", fileIds: [], projectSearch: true });
    expect(run.status).toBe("failed");
    expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("AI_PROJECT_SEARCH_INVALID");
    expect(provider.received).toHaveLength(1);
  });
}

test("bounds autonomous searches even when the model ignores tool_choice none", async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  provider.respond((_request, index) => calls(queryCall(`search-${index}`)));
  const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "texgpt", prompt: "Search", fileIds: [], projectSearch: true });
  expect(run.status).toBe("failed");
  expect(provider.received).toHaveLength(4);
  expect(provider.received[3]?.tool_choice).toBe("none");
  expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("AI_PROJECT_SEARCH_INVALID");
});

test("discovered excerpts never grant edit authority", async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(request => request.messages.some(item => item.role === "tool")
    ? answer([{ fileId: original.file.id, path: original.file.path, from: 0, to: 0, before: "", after: "unauthorized" }])
    : calls(queryCall()));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "texgpt", prompt: "Search", fileIds: [], projectSearch: true });
  expect(run.status).toBe("failed");
  expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("AI_PATCH_INVALID");
  expect(run.proposals).toEqual([]);
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(original.text);
});

for (const stage of [1, 2]) test(`confidentiality change at provider call ${stage} fences search or publication`, async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  provider.respond(async (_request, index) => {
    if (index === stage) await fixture.ai.store.setSecurity(session.actor, { scope, confidential: true, expectedVersion: 0 });
    return index === 1 ? calls(queryCall()) : answer();
  });
  const run = await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "Search", fileIds: [], projectSearch: true });
  expect(run.status).toBe("canceled");
  expect(run.messages).toEqual([]);
  expect(provider.received).toHaveLength(stage);
});

test("changed discovered source prevents final publication", async () => {
  await using provider = searchProvider();
  await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(async (_request, index) => {
    if (index === 1) return calls(queryCall());
    await fixture.core.serialized(scope, lease => fixture.core.commitSource({
      actorId: session.user.id, scope, lease, expectedRevision: original.file.version.revision,
      inputs: [{ file: original.file, bytes: new TextEncoder().encode("Changed source") }],
    }));
    return answer();
  });
  const run = await fixture.run(session, { scope, mode: "ask", tool: "chat", prompt: "Search", fileIds: [], projectSearch: true });
  expect(run.status).toBe("canceled");
  expect((await fixture.ai.get(session.actor, run.id)).errorCode).toBe("AI_CONTEXT_STALE");
  expect(run.messages).toEqual([]);
});
