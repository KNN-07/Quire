import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { AiRunSchema, EventSchema, resourceVersionTag } from "@quire/contracts";
import { defaultPreferences } from "../../../services/accounts/identity/store";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { aiFixture, failure, runSchema } from "./harness";
import { providerServer } from "./provider";

const ownedPaths: string[] = [];
afterAll(() => {
  for (const path of ownedPaths) expect(existsSync(path)).toBe(false);
  console.info("P68_CLEANUP", JSON.stringify({ removed: ownedPaths }));
});

async function entered(gate: ReturnType<ReturnType<typeof providerServer>["gate"]>) {
  const signal = AbortSignal.timeout(10_000);
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try { await Promise.race([gate.entered, aborted.promise]); }
  finally { signal.removeEventListener("abort", abort); }
}

async function events(reader: ReadableStreamDefaultReader<Uint8Array>, until: string) {
  let text = "";
  while (!text.includes(until)) {
    const part = await reader.read();
    if (part.done) throw new TypeError("Step event stream ended");
    text += new TextDecoder().decode(part.value);
  }
  return text.split("\n").filter(line => line.startsWith("data: "))
    .map(line => EventSchema.parse(JSON.parse(line.slice(6))));
}

test("gated real HTTP exposes persisted provider progress, versions, authorized events and replay without source edits", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin, { review: true });
  ownedPaths.push(fixture.path);
  const owner = await fixture.login();
  const other = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(owner);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const before = await fixture.core.readDocument(scope, project.settings.mainFileId);
  const request = { scope, mode: "ask" as const, tool: "chat" as const,
    prompt: "private step prompt", fileIds: [before.file.id] };
  const key = crypto.randomUUID();
  const stream = await fixture.request("/api/events?after=0", { headers: owner.headers });
  const reader = stream.body?.getReader();
  if (!reader) throw new TypeError("Expected event body");
  const gate = provider.gate();
  try {
    await events(reader, ": ready\n\n");
    const runningEvent = events(reader, '"status":"running"');
    const finished = fixture.settled();
    const response = await fixture.request(`/api/projects/${project.id}/ai/runs`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": key }, body: JSON.stringify(request) });
    expect(response.status).toBe(202);
    const created = runSchema.parse(await response.json()).data;
    expect(created.steps.map(step => step.kind)).toEqual(["context"]);
    await entered(gate);
    const running = runSchema.parse(await (await fixture.request(`/api/ai/runs/${created.id}`, { headers: owner.headers })).json()).data;
    expect(running.status).toBe("running");
    expect(running.steps).toEqual([
      { kind: "context", status: "succeeded", startedAt: fixture.clock.now(), finishedAt: fixture.clock.now() },
      { kind: "provider", status: "running", startedAt: fixture.clock.now(), finishedAt: null },
    ]);
    expect((await runningEvent).some(event => event.aggregateId === created.id && event.topic === "operation.changed")).toBe(true);
    expect((await fixture.request(`/api/ai/runs/${created.id}`, { headers: other.headers })).status).toBe(404);
    const replay = await fixture.ai.create(owner.actor, { request, key });
    expect(replay.steps).toEqual(running.steps);
    expect(provider.received).toHaveLength(1);
    fixture.clock.advance(750);
    const completedEvent = events(reader, '"status":"succeeded"');
    gate.release();
    await finished;
    const completedResponse = await fixture.request(`/api/ai/runs/${created.id}`, { headers: owner.headers });
    const completed = runSchema.parse(await completedResponse.json()).data;
    expect(completedResponse.headers.get("etag")).toBe(resourceVersionTag(completed.version));
    expect(completed.version).toBeGreaterThan(running.version);
    expect(completed.steps.map(step => [step.kind, step.status])).toEqual([
      ["context", "succeeded"], ["provider", "succeeded"], ["validation", "succeeded"], ["publication", "succeeded"],
    ]);
    expect(completed.steps.slice(1).every(step => step.finishedAt === fixture.clock.now())).toBe(true);
    expect((await completedEvent).some(event => event.aggregateId === completed.id)).toBe(true);
    const record = await fixture.runtime.db.get<{ request_json: string; steps_json: string }>(
      "SELECT request_json,steps_json FROM ai_run_metadata WHERE run_id=?", [created.id]);
    expect(JSON.stringify(record)).not.toContain(request.prompt);
    expect(Object.keys(completed.steps[0] ?? {})).toEqual(["kind", "status", "startedAt", "finishedAt"]);
    expect((await fixture.core.readDocument(scope, before.file.id)).text).toBe(before.text);
    const { steps: _steps, ...older } = completed;
    expect(AiRunSchema.parse(older).steps).toEqual([]);
    console.info("P68_GATED_STAGES", JSON.stringify({ created: created.steps, running: running.steps, completed: completed.steps,
      versions: [created.version, running.version, completed.version], etag: completedResponse.headers.get("etag") }));
    await reader.cancel();
    await fixture.restart();
    expect((await fixture.ai.get(owner.actor, completed.id)).run.steps).toEqual(completed.steps);
    expect(await failure(fixture.ai.get(other.actor, completed.id))).toMatchObject({ code: "NOT_FOUND" });
    expect(provider.received).toHaveLength(1);
  } finally { gate.release(); await reader.cancel(); }
}, 30_000);

test("only actual citation retrieval adds a retrieval step", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  ownedPaths.push(fixture.path);
  const owner = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(owner);
  await fixture.runtime.db.run("UPDATE preferences SET value_json=? WHERE user_id=?", [
    JSON.stringify({ ...defaultPreferences, citationWebSearch: true, citationProviders: ["crossref"] }), owner.user.id]);
  const operator = await fixture.login("operator@quire.local");
  expect((await fixture.request("/api/admin/providers/crossref", { method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
    body: JSON.stringify({ baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: 0 }) })).status).toBe(200);
  const run = await fixture.run(owner, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "citation-reviewer", prompt: "Retrieve", fileIds: [] });
  expect(provider.contexts[0]?.publications).toHaveLength(1);
  expect(run.steps.map(step => step.kind)).toEqual(["context", "retrieval", "provider", "validation", "publication"]);
  expect(run.steps.every(step => step.status === "succeeded" && step.finishedAt !== null)).toBe(true);
});

test.each(["malformed", "provenance", "http"] as const)("real %s failure closes only the stage reached", async cause => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  ownedPaths.push(fixture.path);
  const owner = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(owner);
  if (cause === "malformed") provider.respond(() => ({ invalid: true }));
  if (cause === "provenance") provider.respond({ text: "Unverified", patches: [], citations: [{ provider: "crossref", providerId: "invented" }] });
  if (cause === "http") provider.status(503);
  const run = await fixture.run(owner, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "chat", prompt: "Fail", fileIds: [] });
  expect(run.status).toBe("failed");
  expect(run.steps.at(-1)).toMatchObject({ kind: cause === "provenance" ? "validation" : "provider",
    status: "failed", finishedAt: fixture.clock.now() });
  expect(run.steps.some(step => step.status === "running" || step.kind === "publication")).toBe(false);
  expect(run.errorCode).toBe(cause === "malformed" ? "AI_RESPONSE_INVALID" : cause === "provenance" ? "AI_CITATION_UNVERIFIED" : "PROVIDER_HTTP_ERROR");
});

test.each(["cancel", "clear-session", "clear-shared", "expiry", "interruption", "close"] as const)(
  "%s finalizes the actual gated provider stage without publishing output", async cause => {
    await using provider = providerServer();
    await using fixture = await aiFixture(provider.origin);
    ownedPaths.push(fixture.path);
    const owner = await fixture.login();
    await fixture.configure();
    const project = await fixture.project(owner);
    const scope = { projectId: project.id, branch: project.defaultBranch };
    const conversation = cause === "expiry" || cause === "clear-shared" ? await fixture.ai.conversations.create(owner.actor, project.id) : undefined;
    const request = { scope, mode: "ask" as const, tool: "chat" as const, prompt: "Do not publish", fileIds: [],
      ...(conversation ? { conversationId: conversation.id } : {}) };
    const gate = provider.gate();
    const finished = cause === "interruption" ? undefined : fixture.settled();
    try {
      const run = await fixture.ai.create(owner.actor, { request, key: crypto.randomUUID() });
      await entered(gate);
      const running = await fixture.ai.get(owner.actor, run.id);
      expect(running.run.steps.at(-1)?.status).toBe("running");
      if (cause === "cancel") await fixture.ai.cancel(owner.actor, { id: run.id, expectedVersion: running.version });
      if (cause === "clear-session") await fixture.ai.conversations.clearSession(owner.actor, scope);
      if (cause === "clear-shared" && conversation) await fixture.ai.conversations.clear(owner.actor,
        { id: conversation.id, projectId: project.id, expectedVersion: 0 });
      if (cause === "expiry") {
        fixture.clock.advance(31 * 86400_000);
        await fixture.ai.conversations.expire();
      }
      if (cause === "interruption") {
        fixture.clock.advance(120_001);
        await using other = await fixture.fork();
        expect((await other.service.store.record(run.id)).error_code).toBe("AI_INTERRUPTED");
      }
      if (cause === "close") await fixture.ai.close();
      await finished;
      gate.release();
      await fixture.ai.close();
      const record = await fixture.ai.store.record(run.id);
      const completed = fixture.ai.store.dto(record);
      expect(completed.status).toBe(cause === "interruption" ? "failed" : "canceled");
      expect(completed.steps.at(-1)).toMatchObject({ kind: "provider",
        status: cause === "interruption" ? "failed" : "canceled", finishedAt: fixture.clock.now() });
      expect(completed.steps.some(step => step.status === "running" || step.kind === "publication")).toBe(false);
      expect(completed.messages).toEqual([]);
      expect(completed.proposals).toEqual([]);
      expect(await fixture.ai.store.usage(owner.actor, "2026-10")).toMatchObject({ used: 1, refunded: 0 });
    } finally { gate.release(); }
  }, 30_000);
