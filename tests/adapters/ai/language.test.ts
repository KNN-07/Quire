import { expect, test } from "bun:test";
import { FileEntrySchema, languageSelectionEligible } from "@quire/contracts";
import { aiFixture } from "./harness";
import { providerServer } from "./provider";

test.each([
  ["synonyms", "naïve", true], ["synonyms", "e\u0301lan", true], ["synonyms", "研究", true],
  ["synonyms", "two words", false], ["synonyms", "word!", false],
  ["split", "研究です。", true], ["split", "One sentence. Another.", false],
  ["join", "第一句。第二句。", true], ["join", "One sentence.", false],
  ["paraphrase", "😀 text", true], ["grammar", "   ", false],
] as const)("%s eligibility uses Unicode segments for %s", (tool, text, eligible) => {
  expect(languageSelectionEligible(tool, { from: 0, to: text.length, text })).toBe(eligible);
});

test("rejects ineligible language ranges before dispatch and preserves disabled preferences across unrelated patches", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login(); await fixture.configure();
  const project = await fixture.project(owner);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const text = "naïve word. 第二句。";
  const created = await fixture.request(`/api/projects/${project.id}/files`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, path: "language.tex", kind: "file", text,
      expectedVersion: (await fixture.core.getBranch(scope)).revision }) });
  const file = FileEntrySchema.parse((await created.json()).data);
  const stored = await fixture.request("/api/me/preferences", { headers: owner.headers });
  const initial = (await stored.json()).data;
  expect(initial.languageEnabled).toBe(true);
  expect(initial.languageFloatingMenu).toBe(true);
  const patch = async (values: object, expectedVersion: number) => {
    const response = await fixture.request("/api/me/preferences", { method: "PATCH", headers: owner.headers,
      body: JSON.stringify({ ...values, expectedVersion }) });
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };
  const enabled = await patch({ inlineCompletion: true }, initial.version);
  const invoke = (tool: string, selection?: { from: number; to: number; text: string }) =>
    fixture.request(`/api/projects/${project.id}/ai/runs`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ scope, mode: "agent", tool, prompt: "Propose a reviewed edit", fileIds: [file.id],
        ...(selection ? { selection: { fileId: file.id, ...selection } } : {}) }) });
  for (const [tool, selected] of [
    ["grammar", undefined], ["synonyms", { from: 0, to: text.length, text }],
    ["split", { from: 0, to: text.length, text }],
    ["join", { from: 0, to: 5, text: "naïve" }],
    ["inline-completion", { from: 0, to: 5, text: "naïve" }],
  ] as const) {
    const response = await invoke(tool, selected);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("AI_SELECTION_INELIGIBLE");
  }
  const disabled = await patch({ languageEnabled: false, languageFloatingMenu: false }, enabled.version);
  const unrelated = await patch({ aiStyle: "academic" }, disabled.version);
  expect(unrelated.languageEnabled).toBe(false);
  expect(unrelated.languageFloatingMenu).toBe(false);
  const denied = await invoke("synonyms", { from: 0, to: 5, text: "naïve" });
  expect(denied.status).toBe(403);
  expect((await denied.json()).error.code).toBe("AI_LANGUAGE_DISABLED");
  expect(provider.received).toHaveLength(0);
  expect(await fixture.ai.store.usage(owner.actor, "2026-10")).toMatchObject({ used: 0, reserved: 0 });
});
