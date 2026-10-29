import { expect, test } from "bun:test";
import { BranchSchema, endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticateApi, nextApplicationEvent, projectDocument, waitForRenderedText } from "../../ui-editor/shared";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";
import { consent } from "../../ui-editor/diagnostic-ai/fixture";
import { editorPath, hash, matrix, openAssistant, preferencesFixture, savePreferences, scope, sourceSelector } from "./fixture";

test("saved future sharing choice isolates private history and branch default requires native approval", async () => {
  await using setup = await preferencesFixture();
  const { app, owner, context, page, provider, evidence } = setup;
  await openAssistant(page);
  await consent(page);
  expect(await page.getByRole("combobox", { name: "Future conversation choice", exact: true }).inputValue()).toBe("private");
  expect(await page.getByRole("button", { name: "Create shared conversation", exact: true }).isDisabled()).toBe(true);
  const original = await projectDocument(context, scope);
  const branches = async () => editorValue(resultSchema(endpoints.gitBranches.output).parse(await (await owner.http.get(
    `api/projects/${scope.projectId}/git/branches`, { searchParams: { branch: scope.branch } })).json()));
  const baselineBranches = await branches();
  const send = async (prompt: string) => {
    await page.getByLabel("Message the assistant").fill(prompt);
    using completed = nextApplicationEvent(app, event => event.topic === "operation.changed" && event.payload.status === "succeeded");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const terminal = await completed.promise;
    await waitForRenderedText(page, terminal.aggregateId);
    return editorValue(resultSchema(endpoints.aiRunGet.output).parse(await (await context.request.get(`/api/ai/runs/${terminal.aggregateId}`)).json()));
  };
  const privatePrompt = `private-${crypto.randomUUID()}`;
  const privateRun = await send(privatePrompt);
  expect(privateRun.conversationId).toBeNull();
  const saved = await savePreferences(page, { shared: true, branch: true });
  await openAssistant(page);
  expect(await page.getByRole("combobox", { name: "Future conversation choice", exact: true }).inputValue()).toBe("shared");
  expect(await page.getByRole("status", { name: "Message visibility" }).innerText()).toContain("private");
  expect(provider.received).toHaveLength(1);
  expect(await app.application.runtime.db.all("SELECT id FROM ai_conversations")).toHaveLength(0);
  await matrix(setup, "future-shared-private-current", ".qa-assistant select");
  const created = page.waitForResponse(response => response.url().endsWith(`/projects/${scope.projectId}/ai/conversations`)
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create shared conversation", exact: true }).click();
  const createResponse = await created;
  expect(createResponse.status()).toBe(200);
  const conversation = editorValue(resultSchema(endpoints.aiConversationCreate.output).parse(await createResponse.json()));
  expect(conversation.messages).toEqual([]);
  await waitForRenderedText(page, conversation.id);
  expect(await page.getByRole("region", { name: "Assistant messages", exact: true }).innerText()).not.toContain(privatePrompt);
  const sharedPrompt = `shared-${crypto.randomUUID()}`;
  const sharedRun = await send(sharedPrompt);
  expect(sharedRun.conversationId).toBe(conversation.id);
  const shared = editorValue(resultSchema(endpoints.aiConversationGet.output).parse(await (await owner.http.get(
    `api/projects/${scope.projectId}/ai/conversations/${conversation.id}`)).json()));
  expect(shared.messages.map(message => message.text)).toEqual([sharedPrompt, "Done"]);
  expect(JSON.stringify(provider.received.at(-1))).not.toContain(privatePrompt);
  const other = await authenticateApi(app, "mai@quire.local");
  const otherContext = await setup.browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
  try {
    await otherContext.addCookies([other.cookie]);
    const otherPage = await otherContext.newPage();
    await openAssistant(otherPage);
    expect(await otherPage.getByRole("combobox", { name: "Future conversation choice", exact: true }).inputValue()).toBe("private");
    const denied = await other.http.get(`api/ai/runs/${privateRun.id}`);
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    const visible = editorValue(resultSchema(endpoints.aiConversationGet.output).parse(await (await other.http.get(
      `api/projects/${scope.projectId}/ai/conversations/${conversation.id}`)).json()));
    expect(visible.messages).toEqual(shared.messages);
  } finally { await otherContext.close(); }
  await savePreferences(page, { shared: false, branch: false });
  expect(await page.getByRole("status", { name: "Message visibility" }).innerText()).toContain(conversation.id);
  await page.getByRole("combobox", { name: "Future conversation choice", exact: true }).selectOption("private");
  await page.getByRole("button", { name: "Use private session", exact: true }).click();
  await openAssistant(page);
  expect(await page.getByRole("combobox", { name: "Future conversation choice", exact: true }).inputValue()).toBe("private");
  // Agent approval is independent of the sharing choice and does not mutate before Accept.
  provider.respond(request => {
    const file = request.files[0];
    if (!file) throw new TypeError("Native selected file required");
    return { text: "Propose an explicitly reviewed comment.", patches: [{
      fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% reviewed preference branch\n",
    }], citations: [] };
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.locator(".qa-assistant__context summary").click();
  await page.getByRole("checkbox", { name: "main.tex", exact: true }).check();
  const falseRun = await send("Propose a comment without applying it.");
  expect(await page.getByLabel("New branch (optional, ai/ prefix)").inputValue()).toBe("");
  const firstRejection = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname === endpoints.aiRunDecide.path.replace(":id", falseRun.id));
  await page.getByRole("button", { name: "Reject all", exact: true }).click();
  expect(editorValue(resultSchema(endpoints.aiRunDecide.output).parse(await (await firstRejection).json()))
    .proposals.flatMap(proposal => proposal.edits).filter(edit => edit.status === "rejected")).toHaveLength(1);
  expect(await branches()).toEqual(baselineBranches);
  expect((await projectDocument(context, scope)).text).toBe(original.text);
  await savePreferences(page, { branch: true });
  await openAssistant(page);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.locator(".qa-assistant__context summary").click();
  await page.getByRole("checkbox", { name: "main.tex", exact: true }).check();
  const rejectedRun = await send("Propose a comment for rejection.");
  const rejectedBranch = `ai/${rejectedRun.id}`;
  expect(await page.getByLabel("New branch (optional, ai/ prefix)").inputValue()).toBe(rejectedBranch);
  expect(BranchSchema.parse(rejectedBranch)).toBe(rejectedBranch);
  expect(await branches()).toEqual(baselineBranches);
  await page.getByRole("button", { name: "Use current branch for this run", exact: true }).click();
  expect(await page.getByLabel("New branch (optional, ai/ prefix)").inputValue()).toBe("");
  const secondRejection = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname === endpoints.aiRunDecide.path.replace(":id", rejectedRun.id));
  await page.getByRole("button", { name: "Reject all", exact: true }).click();
  expect(editorValue(resultSchema(endpoints.aiRunDecide.output).parse(await (await secondRejection).json()))
    .proposals.flatMap(proposal => proposal.edits).filter(edit => edit.status === "rejected")).toHaveLength(1);
  expect(await branches()).toEqual(baselineBranches);
  const acceptedRun = await send("Propose a comment for branch approval.");
  const acceptedBranch = `ai/${acceptedRun.id}`;
  const commitPreferences = editorValue(resultSchema(endpoints.preferencesGet.output).parse(
    await (await owner.http.get("api/me/preferences")).json()));
  expect((await owner.http.patch("api/me/preferences", {
    json: { compileBeforeCommit: true, expectedVersion: commitPreferences.version },
  })).status).toBe(200);
  await page.getByRole("checkbox", { name: "Commit accepted changes", exact: true }).check();
  expect(await page.getByLabel("New branch (optional, ai/ prefix)").inputValue()).toBe(acceptedBranch);
  expect(await branches()).toEqual(baselineBranches);
  expect((await projectDocument(context, scope)).text).toBe(original.text);
  await matrix(setup, "branch-before-approval", ".qa-assistant__review");
  const tracking = await surfaceSignal(page, ".qa-assistant__review button:disabled");
  await page.getByRole("button", { name: "Track changes off", exact: true }).click();
  await tracking.observed;
  expect(await page.getByRole("button", { name: "Accept all", exact: true }).isDisabled()).toBe(true);
  const writable = await surfaceSignal(page, ".qa-assistant__review button:not([disabled])");
  await page.getByRole("button", { name: "Track changes on", exact: true }).click();
  await writable.observed;
  await page.getByRole("checkbox", { name: "Commit accepted changes", exact: true }).check();
  const decision = page.waitForResponse(response => response.url().endsWith(`/ai/runs/${acceptedRun.id}/decide`)
    && response.request().method() === "POST");
  using compiled = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === scope.projectId && event.payload.status === "succeeded", 90_000);
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  const decided = await decision;
  expect(setup.receipts.find(receipt => receipt.method === "POST"
    && receipt.path === `/api/ai/runs/${acceptedRun.id}/decide`)?.body)
    .toMatchObject({ decision: "accept", commit: true, newBranch: acceptedBranch });
  expect(decided.status()).toBe(200);
  const approved = editorValue(resultSchema(endpoints.aiRunDecide.output).parse(await decided.json()));
  expect(approved.scope.branch).toBe(acceptedBranch);
  expect(approved.proposals.flatMap(proposal => proposal.edits).every(edit => edit.status === "accepted")).toBe(true);
  await waitForRenderedText(page, acceptedBranch);
  const actualBranches = await branches();
  expect(actualBranches.some(branch => branch.name === acceptedBranch)).toBe(true);
  expect(actualBranches.some(branch => branch.name === rejectedBranch)).toBe(false);
  const branchDocument = await projectDocument(context, { ...scope, branch: acceptedBranch });
  expect(branchDocument.text).toBe("% reviewed preference branch\n" + original.text);
  expect((await projectDocument(context, scope)).text).toBe(original.text);
  const compileEvent = await compiled.promise;
  if (compileEvent.topic !== "job.changed") throw new TypeError("Compile event required");
  const compileJob = await app.application.runtime.services.get("compiler").get(owner.user.id, compileEvent.payload.resourceId);
  const namedTree = new TextDecoder().decode(await app.application.runtime.repositories.read(scope.projectId,
    ["rev-parse", `refs/heads/${acceptedBranch}^{tree}`])).trim();
  expect(compileJob.status).toBe("succeeded");
  expect(compileJob.snapshot.tree).toBe(`sha1:${namedTree}`);
  expect(setup.errors).toEqual([]);
  await Bun.write(`${evidence}/workflow.json`, JSON.stringify({ utc: new Date().toISOString(), saved,
    privateRun, sharedRun, conversation, shared, falseRun, rejectedRun, acceptedRun, approved, compileJob, namedTree,
    baselineBranches, actualBranches, beforeHash: hash(original.text), mainAfterHash: hash((await projectDocument(context, scope)).text),
    approvedBranchHash: hash(branchDocument.text) }, null, 2));
}, 240_000);

test("error assistance persists per actor and hides offers without bypassing diagnostics, Viewer or confidential guards", async () => {
  await using setup = await preferencesFixture();
  const { app, page, context, owner, provider, evidence } = setup;
  await openAssistant(page);
  const original = await projectDocument(context, scope);
  const command = "\\QuireUndefinedPreferenceCommand";
  const broken = original.text.replace("\\end{document}", `${command}\n\\end{document}`);
  using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
    && event.aggregateId === scope.projectId && event.payload.resourceId === scope.fileId);
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).click();
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+A");
  await page.keyboard.insertText(broken);
  await saved.promise;
  using failed = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === scope.projectId && event.payload.status === "failed", 90_000);
  await page.getByRole("button", { name: "Recompile", exact: true }).click();
  await failed.promise;
  await openSurface(page, { path: `/projects/${scope.projectId}/logs`, selector: ".q-pdf-diagnostics" });
  expect(await page.getByRole("button", { name: "Fix with AI", exact: true }).count()).toBe(0);
  await matrix(setup, "error-off", ".q-pdf-diagnostics");
  await openAssistant(page);
  await savePreferences(page, { error: true });
  await openSurface(page, { path: `/projects/${scope.projectId}/logs`, selector: ".q-pdf-diagnostics button[title]:not([disabled])" });
  const card = page.locator(".q-pdf-diagnostics li").filter({ hasText: "Undefined control sequence" }).first();
  expect(await card.getByRole("button", { name: "Fix with AI", exact: true }).isEnabled()).toBe(true);
  await matrix(setup, "error-on", ".q-pdf-diagnostics");
  const chosen = await surfaceSignal(page, '.qa-assistant [aria-label="Selected diagnostic"]');
  await card.getByRole("button", { name: "Fix with AI", exact: true }).click();
  await chosen.observed;
  expect(await page.getByLabel("Send the selected diagnostic and its recorded log excerpt").isChecked()).toBe(false);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".qa-assistant__error").waitFor({ state: "visible" });
  expect(provider.received).toHaveLength(0);
  await consent(page);
  await page.getByLabel("Send the selected diagnostic and its recorded log excerpt").check();
  await page.locator(".qa-assistant__settings summary").click();
  await page.getByLabel("Confidential project").check();
  const securitySaved = page.waitForResponse(response => response.request().method() === "PUT"
    && new URL(response.url()).pathname === endpoints.aiSecurityPut.path.replace(":p", scope.projectId));
  await page.getByRole("button", { name: "Save security label", exact: true }).click();
  expect(editorValue(resultSchema(endpoints.aiSecurityPut.output).parse(await (await securitySaved).json())).confidential).toBe(true);
  await page.locator(".qa-assistant__settings summary").click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "AI_CONFIDENTIAL");
  expect(provider.received).toHaveLength(0);
  const viewer = await authenticateApi(app, "alex@quire.local");
  const prefs = editorValue(resultSchema(endpoints.preferencesGet.output).parse(await (await viewer.http.get("api/me/preferences")).json()));
  expect(prefs.errorAssist).toBe(false);
  expect((await viewer.http.patch("api/me/preferences", { json: { errorAssist: true, expectedVersion: prefs.version } })).status).toBe(200);
  const viewerContext = await setup.browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
  try {
    await viewerContext.addCookies([viewer.cookie]);
    const viewerPage = await viewerContext.newPage();
    await openSurface(viewerPage, { path: `/projects/${scope.projectId}/logs`, selector: ".q-pdf-diagnostics" });
    const offered = viewerPage.getByRole("button", { name: "Fix with AI", exact: true });
    expect(await offered.count()).toBeGreaterThan(0);
    for (const button of await offered.all()) expect(await button.isDisabled()).toBe(true);
    await openAssistant(viewerPage);
    expect(await viewerPage.getByRole("button", { name: "Agent", exact: true }).isDisabled()).toBe(true);
  } finally { await viewerContext.close(); }
  await savePreferences(page, { error: false });
  await openSurface(page, { path: `/projects/${scope.projectId}/logs`, selector: ".q-pdf-diagnostics" });
  expect(await page.getByRole("button", { name: "Fix with AI", exact: true }).count()).toBe(0);
  await openAssistant(page);
  await savePreferences(page, { error: true });
  await openSurface(page, { path: editorPath, selector: sourceSelector });
  await page.getByRole("button", { name: "Track changes off", exact: true }).click();
  await openSurface(page, { path: `/projects/${scope.projectId}/logs`, selector: ".q-pdf-diagnostics" });
  expect(await page.getByRole("button", { name: "Fix with AI", exact: true }).count()).toBe(0);
  expect((await projectDocument(context, scope)).text).toBe(broken);
  expect(provider.received).toHaveLength(0);
  expect(setup.errors).toEqual([]);
  const preferences = editorValue(resultSchema(endpoints.preferencesGet.output).parse(await (await owner.http.get("api/me/preferences")).json()));
  await Bun.write(`${evidence}/diagnostics.json`, JSON.stringify({ utc: new Date().toISOString(), preferences,
    beforeHash: hash(original.text), brokenHash: hash(broken), afterHash: hash((await projectDocument(context, scope)).text),
    providerRequests: provider.received.length, viewerPreferenceVersion: prefs.version }, null, 2));
}, 240_000);
