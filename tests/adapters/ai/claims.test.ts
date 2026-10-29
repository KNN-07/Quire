import { expect, test } from "bun:test";
import { z } from "zod";
import { AiRunSchema, FileEntrySchema, IdSchema, PublicationSchema } from "@quire/contracts";
import { AnswerSchema } from "../../../services/adapters/ai/model";
import { claimFindings } from "../../../services/adapters/ai/findings";
import { defaultPreferences } from "../../../services/accounts/identity/store";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { AiOperatorPolicies } from "../../../services/adapters/shared/provider-policy";
import { aiFixture, failure } from "./harness";
import { providerServer } from "./provider";

const id = IdSchema.parse("00000000-0000-4000-8000-000000000001");
const file = { id, path: "main.tex", text: "😀 Supported. Unsupported.", from: 3, to: 26, epoch: 2, revision: 7, state: "" };
const citation = { provider: "crossref", providerId: "10.1234/verified" };
const publication = PublicationSchema.parse({ ...citation, title: "Retrieved paper", authors: ["Ada Example"],
  year: 2025, doi: citation.providerId, url: null, bibtex: "@article{exact-key,title={Retrieved paper}}" });
const finding = { fileId: id, path: file.path, from: 14, to: 26, quote: "Unsupported.", assessment: "unsupported" as const,
  explanation: "The retrieved study does not support this claim.", citations: [citation] };

test("binds exact UTF-16 source range and server epoch/revision without changing source", () => {
  const before = structuredClone(file);
  const answer = AnswerSchema.parse({ text: "Review", patches: [], citations: [], findings: [finding] });
  expect(claimFindings(answer, [file], [publication])).toEqual([{ ...finding, epoch: 2, revision: 7 }]);
  expect(file).toEqual(before);
  expect(AnswerSchema.parse({ text: "Legacy", patches: [], citations: [] }).findings).toEqual([]);
});
test.each([
  { change: { from: 0, to: 2, quote: "😀" }, code: "AI_FINDING_INVALID" },
  { change: { from: 1, to: 2, quote: "\ude00" }, code: "AI_FINDING_INVALID" },
  { change: { to: 9000 }, code: "AI_FINDING_INVALID" },
  { change: { quote: "Wrong quote" }, code: "AI_FINDING_INVALID" },
  { change: { from: 14, to: 14 }, code: "AI_FINDING_INVALID" },
  { change: { fileId: "00000000-0000-4000-8000-000000000002" }, code: "AI_FINDING_INVALID" },
  { change: { path: "../other.tex" }, code: "AI_FINDING_INVALID" },
  { change: { citations: [{ ...citation, providerId: "invented" }] }, code: "AI_CITATION_UNVERIFIED" },
])("rejects mismatched or out-of-scope assessment $change", ({ change, code }) => {
  const answer = AnswerSchema.parse({ text: "Review", patches: [], citations: [], findings: [{ ...finding, ...change }] });
  expect(() => claimFindings(answer, [file], [publication])).toThrow(expect.objectContaining({ code }));
});
test("strictly rejects malformed assessment and provider supplied source version", () => {
  for (const change of [{ from: 0.5 }, { assessment: "certain" }, { epoch: 9 }, { extra: true }, { quote: "" }]) {
    expect(AnswerSchema.safeParse({ text: "", patches: [], citations: [], findings: [{ ...finding, ...change }] }).success).toBe(false);
  }
});

async function configure(fixture: Awaited<ReturnType<typeof aiFixture>>, provider: ReturnType<typeof providerServer>) {
  const session = await fixture.login();
  await fixture.configure();
  const project = await fixture.project(session);
  await fixture.runtime.db.run("UPDATE preferences SET value_json=? WHERE user_id=?", [
    JSON.stringify({ ...defaultPreferences, citationWebSearch: true, citationProviders: ["crossref"] }), session.user.id]);
  const operator = await fixture.login("operator@quire.local");
  expect((await fixture.request("/api/admin/providers/crossref", { method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
    body: JSON.stringify({ baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: 0 }) })).status).toBe(200);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  provider.respond(context => ({ text: "Model assessment", patches: [], citations: [citation],
    findings: context.files.flatMap(item => [
      { fileId: item.id, path: item.path, from: item.from, to: item.from + 1, quote: item.text.slice(0, 1),
        assessment: "supported", explanation: "Supplied publication is relevant.", citations: [citation] },
      { fileId: item.id, path: item.path, from: item.from + 1, to: item.from + 2, quote: item.text.slice(1, 2),
        assessment: "unsupported", explanation: "Insufficient support.", citations: [] },
    ]) }));
  return { session, project, scope, request: { scope, mode: "ask" as const, tool: "citation-reviewer" as const,
    prompt: "Review claims", fileIds: [project.settings.mainFileId] } };
}

test("private Ask findings are session-local, cleared and absent after restart; Agent findings persist", async () => {
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const { session, request, scope, project } = await configure(fixture, provider);
  const before = await fixture.core.readDocument(scope, project.settings.mainFileId);
  const ask = await fixture.run(session, request);
  expect(ask.findings.map(item => item.assessment)).toEqual(["supported", "unsupported"]);
  expect(ask.findingsCurrent).toBe(true);
  expect(ask.sources[0]?.providerId).toBe(citation.providerId);
  expect(await fixture.runtime.db.get("SELECT findings_json FROM ai_run_metadata WHERE run_id=?", [ask.id])).toEqual({ findings_json: "[]" });
  const another = await fixture.login();
  expect(await failure(fixture.ai.get(another.actor, ask.id))).toMatchObject({ code: "NOT_FOUND" });
  await fixture.ai.conversations.clearSession(session.actor, scope);
  expect((await fixture.ai.get(session.actor, ask.id)).run.findings).toEqual([]);
  const privateRun = await fixture.run(session, request);
  const agent = await fixture.run(session, { ...request, mode: "agent" });
  await fixture.restart();
  expect((await fixture.ai.get(session.actor, privateRun.id)).run.findings).toEqual([]);
  expect((await fixture.ai.get(session.actor, agent.id)).run.findings).toEqual(agent.findings);
  expect((await fixture.core.readDocument(scope, before.file.id)).text).toBe(before.text);
  const { findings: _findings, ...oldRun } = agent;
  expect(AiRunSchema.parse(oldRun).findings).toEqual([]);
}, 30_000);

test("shared Ask findings follow conversation clearing", async () => {
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const { session, request } = await configure(fixture, provider);
  const shared = await fixture.ai.conversations.create(session.actor, request.scope.projectId);
  const run = await fixture.run(session, { ...request, conversationId: shared.id });
  expect(run.findings).toHaveLength(2);
  await fixture.ai.conversations.clear(session.actor, { id: shared.id, projectId: request.scope.projectId, expectedVersion: 1 });
  expect((await fixture.ai.get(session.actor, run.id)).run.findings).toEqual([]);
});

test.each(["source", "epoch", "consent", "confidential", "actor", "operator"] as const)(
  "discards late claim output after %s changes", async change => {
    await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
    const { session, request, scope, project } = await configure(fixture, provider);
    const gate = provider.gate();
    const finished = fixture.settled();
    const run = await fixture.ai.create(session.actor, { key: crypto.randomUUID(), request });
    await gate.entered;
    if (change === "source" || change === "epoch") {
      const document = await fixture.core.readDocument(scope, project.settings.mainFileId);
      const revision = (await fixture.core.getBranch(scope)).revision;
      await fixture.core.serialized(scope, lease => fixture.core.commitSource({ actorId: session.user.id, scope, lease,
        expectedRevision: revision,
        inputs: [{ file: change === "epoch" ? { ...document.file, version: { ...document.file.version, epoch: document.file.version.epoch + 1 } } : document.file,
          bytes: new TextEncoder().encode(change === "source" ? `% changed\n${document.text}` : document.text) }] }));
    } else if (change === "consent") await fixture.runtime.db.run("UPDATE identity_ai_consent SET accepted=0 WHERE user_id=?", [session.user.id]);
    else if (change === "confidential") await fixture.ai.store.setSecurity(session.actor, { scope, confidential: true, expectedVersion: 0 });
    else if (change === "actor") await fixture.runtime.db.run("DELETE FROM sessions WHERE id=?", [session.actor.sessionId]);
    else {
      const operator = await fixture.login("operator@quire.local");
      await new AiOperatorPolicies(fixture.ai.store.context).put(operator.user.id, {
        requestLogging: "off", citationWebSearch: false, blockConfidentialTags: true, expectedVersion: 0,
      });
    }
    gate.release(); await finished;
    const record = await fixture.ai.store.record(run.id);
    expect(record.status).toBe("canceled");
    expect(record.findings_json).toBe("[]");
    expect(fixture.ai.conversations.findings(record)).toBeUndefined();
  }, 30_000);

test("selected retrieval uses the native citation writer and denies invalid, linked, binary, stale and Viewer targets", async () => {
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const { session, request, scope, project } = await configure(fixture, provider);
  const run = await fixture.run(session, request);
  const selected = run.sources[0];
  if (!selected) throw new TypeError("Retrieved publication required");
  const before = (await fixture.core.readDocument(scope, project.settings.mainFileId)).text;
  const create = async (path: string) => {
    const response = await fixture.request(`/api/projects/${project.id}/files`, { method: "POST",
      headers: { ...session.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({
        scope, path, kind: "file", text: "", expectedVersion: (await fixture.core.getBranch(scope)).revision,
      }) });
    expect(response.status).toBe(200);
    return z.object({ data: FileEntrySchema }).parse(await response.json()).data;
  };
  const target = await create("selected.bib");
  const untouched = await create("untouched.bib");
  const linked = await create("linked.bib");
  const binary = await create("binary.bib");
  await fixture.runtime.db.run("UPDATE files SET editable=0,link_json=? WHERE id=?", [
    JSON.stringify({ kind: "bibliography", sourceId: "owned-link", lastRefreshedAt: null }), linked.id]);
  await fixture.runtime.db.run("UPDATE files SET editable=0,mime='application/octet-stream' WHERE id=?", [binary.id]);
  const copy = async (targetFileId: string, options: {
    readonly actor?: typeof session; readonly expectedVersion?: number; readonly bibtex?: string;
  } = {}) => fixture.request(`/api/projects/${project.id}/citations`, { method: "POST",
    headers: { ...(options.actor ?? session).headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({
      scope, targetFileId, publication: { ...selected, bibtex: options.bibtex ?? selected.bibtex }, command: "cite",
      expectedVersion: options.expectedVersion ?? (await fixture.core.getBranch(scope)).revision,
    }) });
  for (const targetId of [linked.id, binary.id, project.settings.mainFileId]) expect((await copy(targetId)).status).toBe(403);
  expect((await copy(target.id, { bibtex: "@article{broken," })).status).toBe(422);
  expect((await copy(target.id, { expectedVersion: 0 })).status).toBe(409);
  const viewer = await fixture.login("alex@quire.local");
  await fixture.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)",
    [crypto.randomUUID(), project.id, viewer.user.id, fixture.clock.now()]);
  expect((await copy(target.id, { actor: viewer })).status).toBe(403);
  expect((await copy(target.id)).status).toBe(200);
  expect((await fixture.core.readDocument(scope, target.id)).text).toBe(`${selected.bibtex}\n`);
  expect((await fixture.core.readDocument(scope, untouched.id)).text).toBe("");
  expect((await fixture.core.readDocument(scope, project.settings.mainFileId)).text).toBe(before);
  const document = await fixture.core.readDocument(scope, project.settings.mainFileId);
  const revision = (await fixture.core.getBranch(scope)).revision;
  const files = await fixture.core.listFiles(scope);
  await fixture.core.serialized(scope, lease => fixture.core.commitSource({ actorId: session.user.id, scope, lease,
    expectedRevision: revision, inputs: files.map(item => item.id === document.file.id
      ? { file: item, bytes: new TextEncoder().encode(`% later edit\n${document.text}`) } : { file: item }) }));
  const stale = (await fixture.ai.get(session.actor, run.id)).run;
  expect(stale.findingsCurrent).toBe(false);
  expect(stale.findings).toEqual(run.findings);
}, 30_000);
