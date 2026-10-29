import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, resultSchema, TagSchema } from "@quire/contracts";
import { aiFixture, errorSchema, failure } from "../harness";
import { providerServer } from "../provider";
import { AiOperatorPolicies, defaultAiOperatorPolicy } from "../../../../services/adapters/shared/provider-policy";
import type { AiOperatorPolicy } from "../../../../services/adapters/shared/provider-policy";
import { SecretBox } from "../../../../services/adapters/shared/secrets";
import { defaultPreferences } from "../../../../services/accounts/identity/store";
import { defaultPolicy } from "../../../../services/accounts/identity/policy";

type Fixture = Awaited<ReturnType<typeof aiFixture>>;
type Session = Awaited<ReturnType<Fixture["login"]>>;
const path = endpoints.providerAiPolicyPut.path;
async function put(fixture: Fixture, actor: Session, changes: Partial<AiOperatorPolicy>, expectedVersion: number) {
  const response = await fixture.request(path, { method: "PUT",
    headers: { ...actor.headers, "if-match": `"${expectedVersion}"` },
    body: JSON.stringify({ ...defaultAiOperatorPolicy, version: undefined, ...changes, expectedVersion }) });
  return response;
}
async function policy(fixture: Fixture, actor: Session) {
  const response = await fixture.request(path, { headers: actor.headers });
  const result = resultSchema(endpoints.providerAiPolicyGet.output).parse(await response.json());
  if (!("data" in result)) throw new Error(result.error.code);
  return result.data;
}
async function tag(fixture: Fixture, owner: Session, projectId: string, name: string, expectedVersion: number) {
  const created = await fixture.request("/api/tags", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ name, colorHex: "#884422" }) });
  const value = z.object({ data: TagSchema }).parse(await created.json()).data;
  const assigned = await fixture.request(`/api/projects/${projectId}/tags`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${expectedVersion}"` },
    body: JSON.stringify({ tagIds: [value.id], expectedVersion }) });
  expect(assigned.status).toBe(200);
  return value;
}

test("operator policy is authenticated, CSRF-protected, versioned, audited and durable without changing connection settings", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const operator = await fixture.login("operator@quire.local");
  const member = await fixture.login();
  await fixture.configure();
  expect((await fixture.request(path)).status).toBe(401);
  expect((await fixture.request(path, { headers: member.headers })).status).toBe(403);
  expect((await put(fixture, member, {}, 0)).status).toBe(403);
  const noCsrf = await fixture.request(path, { method: "PUT", headers: { cookie: operator.headers.cookie, "if-match": '"0"' },
    body: JSON.stringify({ requestLogging: "metadata", citationWebSearch: false, blockConfidentialTags: true, expectedVersion: 0 }) });
  expect(noCsrf.status).toBe(403);
  expect(await policy(fixture, operator)).toEqual(defaultAiOperatorPolicy);
  const saved = await put(fixture, operator, { requestLogging: "metadata", citationWebSearch: false }, 0);
  expect(saved.status).toBe(200);
  expect(saved.headers.get("etag")).toBe('"1"');
  const stale = await put(fixture, operator, { requestLogging: "off" }, 0);
  expect(stale.status).toBe(409);
  expect(errorSchema.parse(await stale.json()).error.code).toBe("VERSION_CONFLICT");
  const mismatch = await fixture.request(path, { method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
    body: JSON.stringify({ requestLogging: "off", citationWebSearch: true, blockConfidentialTags: false, expectedVersion: 1 }) });
  expect(mismatch.status).toBe(409);
  const audit = await fixture.runtime.db.all("SELECT details_json FROM audit_entries WHERE event='ai.operator-policy.updated'");
  expect(audit).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toContain("fixture-ai-key");
  await fixture.restart();
  expect(await policy(fixture, operator)).toEqual({
    requestLogging: "metadata", citationWebSearch: false, blockConfidentialTags: true, version: 1,
  });
  expect((await fixture.ai.store.services.configuration.get("ai")).version).toBe(1);
  const service = new AiOperatorPolicies(fixture.ai.store.context);
  expect((await failure(service.put(member.user.id, { ...defaultAiOperatorPolicy, expectedVersion: 1 }))).code).toBe("FORBIDDEN");
  console.info("AI_POLICY_PERSISTED", { policyVersion: 1, denied: [401, 403, 409], auditEntries: audit.length });
});

test("logging off, metadata and encrypted retained content preserve private Ask and shared-chat erasure", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  await fixture.configure();
  const project = await fixture.project(owner);
  const request = { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask" as const, tool: "chat" as const, prompt: "private-p28-canary", fileIds: [] };
  const off = await fixture.run(owner, request);
  expect(off.status).toBe("succeeded");
  expect(await fixture.runtime.db.all("SELECT * FROM ai_request_logs")).toHaveLength(0);
  expect((await put(fixture, operator, { requestLogging: "metadata" }, 0)).status).toBe(200);
  const metadata = await fixture.run(owner, request);
  expect(await fixture.runtime.db.get("SELECT status,encrypted_content FROM ai_request_logs WHERE run_id=?", [metadata.id]))
    .toEqual({ status: "succeeded", encrypted_content: null });
  expect((await put(fixture, operator, { requestLogging: "retained-content" }, 1)).status).toBe(200);
  const privateRun = await fixture.run(owner, request);
  expect(await fixture.runtime.db.get("SELECT encrypted_content FROM ai_request_logs WHERE run_id=?", [privateRun.id]))
    .toEqual({ encrypted_content: null });
  expect(JSON.stringify(await fixture.runtime.db.all("SELECT request_json FROM ai_run_metadata"))).not.toContain("private-p28-canary");
  provider.respond({ text: "retained-p28-answer", patches: [], citations: [] });
  const agent = await fixture.run(owner, { ...request, mode: "agent", prompt: "retained-p28-prompt" });
  const logged = z.object({ encrypted_content: z.instanceof(Uint8Array) }).parse(
    await fixture.runtime.db.get("SELECT encrypted_content FROM ai_request_logs WHERE run_id=?", [agent.id]));
  expect(Buffer.from(logged.encrypted_content).toString()).not.toContain("retained-p28");
  expect(JSON.parse(new SecretBox(fixture.ai.store.context.secretKey).open(logged.encrypted_content, `ai-log:${agent.id}`)))
    .toEqual({ prompt: "retained-p28-prompt", response: "retained-p28-answer" });
  const conversation = await fixture.ai.conversations.create(owner.actor, project.id);
  const shared = await fixture.run(owner, { ...request, conversationId: conversation.id, prompt: "shared-p28-prompt" });
  const before = await fixture.runtime.db.get<{ encrypted_content: Uint8Array | null }>("SELECT encrypted_content FROM ai_request_logs WHERE run_id=?", [shared.id]);
  expect(before?.encrypted_content).toBeInstanceOf(Uint8Array);
  const current = await fixture.ai.conversations.get(owner.actor, { id: conversation.id, projectId: project.id });
  await fixture.ai.conversations.clear(owner.actor, { id: conversation.id, projectId: project.id, expectedVersion: current.version });
  expect(await fixture.runtime.db.get("SELECT encrypted_content FROM ai_request_logs WHERE run_id=?", [shared.id]))
    .toEqual({ encrypted_content: null });
  expect((await put(fixture, operator, { requestLogging: "off" }, 2)).status).toBe(200);
  const stopped = await fixture.run(owner, request);
  expect(await fixture.runtime.db.get("SELECT run_id FROM ai_request_logs WHERE run_id=?", [stopped.id])).toBeNull();
  expect((await fixture.ai.store.usage(owner.actor, "2026-10")).used).toBe(6);
  expect(JSON.stringify(await fixture.runtime.db.all("SELECT details_json FROM audit_entries"))).not.toContain("p28-prompt");
  console.info("AI_POLICY_LOGGING", { dispatches: provider.received.length, privateContentLogged: false, encryptedRetained: true, cleared: true });
});

test("operator citation denial prevents retrieval and charging; allowance still requires user search and terms consent", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  await fixture.configure();
  const project = await fixture.project(owner);
  const request = { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask" as const, tool: "citation-reviewer" as const, prompt: "Find a paper", fileIds: [] };
  await fixture.runtime.db.run("UPDATE preferences SET value_json=? WHERE user_id=?",
    [JSON.stringify({ ...defaultPreferences, citationWebSearch: true, citationProviders: ["crossref"] }), owner.user.id]);
  const configured = await fixture.request("/api/admin/providers/crossref", { method: "PUT",
    headers: { ...operator.headers, "if-match": '"0"' },
    body: JSON.stringify({ baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: 0 }) });
  expect(configured.status).toBe(200);
  expect((await put(fixture, operator, { citationWebSearch: false }, 0)).status).toBe(200);
  expect((await failure(fixture.ai.create(owner.actor, { key: crypto.randomUUID(), request }))).code).toBe("AI_CITATION_POLICY_DENIED");
  expect(await fixture.runtime.db.all("SELECT * FROM ai_runs")).toHaveLength(0);
  expect(provider.received).toHaveLength(0);
  expect((await put(fixture, operator, { citationWebSearch: true }, 1)).status).toBe(200);
  provider.respond({ text: "Verified fixture citation", patches: [], citations: [{ provider: "crossref", providerId: "10.1234/verified" }] });
  const allowed = await fixture.run(owner, request);
  expect(allowed.status).toBe("succeeded");
  expect(allowed.sources[0]?.providerId).toBe("10.1234/verified");
  await fixture.runtime.db.run("UPDATE preferences SET value_json=? WHERE user_id=?",
    [JSON.stringify(defaultPreferences), owner.user.id]);
  const denied = await fixture.run(owner, request);
  expect(denied.errorCode).toBe("AI_RETRIEVAL_CONSENT");
  expect(provider.received).toHaveLength(1);
  await fixture.runtime.db.run("UPDATE identity_ai_consent SET accepted=0 WHERE user_id=?", [owner.user.id]);
  expect((await failure(fixture.ai.create(owner.actor, { key: crypto.randomUUID(), request }))).code).toBe("AI_CONSENT_REQUIRED");
  expect(await fixture.ai.store.usage(owner.actor, "2026-10")).toMatchObject({ used: 1, refunded: 1, reserved: 0 });
  console.info("AI_POLICY_CITATION", { deniedBeforeReservation: true, controlledCrossrefId: allowed.sources[0]?.providerId, userConsentRequired: true });
});

test("owner confidential tags are optional extra denial; explicit project confidentiality always wins", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  await fixture.configure();
  const project = await fixture.project(owner);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const request = { scope, mode: "ask" as const, tool: "chat" as const, prompt: "Never disclose", fileIds: [] };
  await tag(fixture, owner, project.id, " Confidential ", project.version);
  expect((await failure(fixture.ai.create(owner.actor, { request, key: crypto.randomUUID() }))).code).toBe("AI_CONFIDENTIAL");
  expect((await put(fixture, operator, { blockConfidentialTags: false }, 0)).status).toBe(200);
  expect((await fixture.run(owner, request)).status).toBe("succeeded");
  await fixture.ai.store.setSecurity(owner.actor, { scope, confidential: true, expectedVersion: 0 });
  expect((await failure(fixture.ai.create(owner.actor, { request, key: crypto.randomUUID() }))).code).toBe("AI_CONFIDENTIAL");
  expect(provider.received).toHaveLength(1);
  expect((await fixture.ai.store.usage(owner.actor, "2026-10")).used).toBe(1);
  console.info("AI_POLICY_CONFIDENTIAL", { tagRuleDisabled: true, explicitConfidentialDenied: true, dispatches: 1 });
});

test("policy changes cancel dispatched work, discard late answers and preserve charged usage", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  await fixture.configure();
  const project = await fixture.project(owner);
  expect((await put(fixture, operator, { requestLogging: "retained-content" }, 0)).status).toBe(200);
  provider.respond({ text: "must-not-persist-late-answer", patches: [], citations: [] });
  const gate = provider.gate();
  const finished = fixture.settled();
  try {
    const run = await fixture.ai.create(owner.actor, { key: crypto.randomUUID(), request: {
      scope: { projectId: project.id, branch: project.defaultBranch },
      mode: "agent", tool: "chat", prompt: "pending", fileIds: [],
    } });
    await gate.entered;
    expect((await put(fixture, operator, { requestLogging: "off" }, 1)).status).toBe(200);
    gate.release();
    await finished;
    const latest = (await fixture.ai.get(owner.actor, run.id)).run;
    expect(latest.status).toBe("canceled");
    expect(latest.errorCode).toBe("AI_CONFIGURATION_CHANGED");
    expect(latest.messages.some(message => message.text === "must-not-persist-late-answer")).toBe(false);
    expect(await fixture.runtime.db.get("SELECT status,error_code FROM ai_request_logs WHERE run_id=?", [run.id]))
      .toEqual({ status: "canceled", error_code: "AI_CONFIGURATION_CHANGED" });
    expect((await fixture.ai.store.usage(owner.actor, "2026-10")).used).toBe(1);
    console.info("AI_POLICY_TRANSITION", { run: run.id, status: latest.status, code: latest.errorCode, charged: 1 });
  } finally { gate.release(); }
});
