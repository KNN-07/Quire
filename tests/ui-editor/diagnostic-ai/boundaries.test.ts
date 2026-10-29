import { expect, test } from "bun:test";
import type { Request } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, nextApplicationEvent, projectDocument, waitForRenderedText } from "../shared";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";
import { brokenDiagnostic, command, consent, diagnosticFixture, projectPath, scope, sourceSelector } from "./fixture";

test("keeps unconfigured, AI-off, disabled and Viewer diagnostic paths out of the provider", async () => {
  await using setup = await diagnosticFixture(false);
  const { app, operator, page, provider, context } = setup;
  const original = await brokenDiagnostic(setup);
  const selected = await surfaceSignal(page, '.qa-assistant [aria-label="Selected diagnostic"]');
  await original.card.getByRole("button", { name: "Fix with AI", exact: true }).click();
  await selected.observed;
  await consent(page);
  await page.getByLabel("Send the selected diagnostic and its recorded log excerpt").check();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "AI_UNCONFIGURED");
  expect(provider.received).toHaveLength(0);
  const configured = await operator.http.put("api/admin/providers/ai", { headers: { "if-match": '"0"' }, json: {
    baseUrl: `${provider.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
    policy: { ...defaultPolicy, ai: "off" }, expectedVersion: 0,
  } });
  expect(configured.status).toBe(200);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "AI_POLICY_DENIED");
  expect(provider.received).toHaveLength(0);
  // Provider PUT always enables configuration; seed the real disabled storage state
  // rather than pretending its public contract accepts an enabled field.
  await app.application.runtime.db.run("UPDATE adapter_provider_configs SET enabled=0,version=version+1 WHERE kind='ai'");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "AI_DISABLED");
  expect(provider.received).toHaveLength(0);
  expect((await projectDocument(context, scope)).text).toBe(original.broken);
  await page.getByRole("alert").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${setup.evidence}/disabled.png` });
  const viewer = await authenticateApi(app, "outsider@quire.local");
  const preferences = editorValue(resultSchema(endpoints.preferencesGet.output).parse(
    await (await viewer.http.get("api/me/preferences")).json()));
  expect((await viewer.http.patch("api/me/preferences", {
    json: { errorAssist: true, expectedVersion: preferences.version },
  })).status).toBe(200);
  await app.application.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)",
    [crypto.randomUUID(), fixtureIds.project, viewer.user.id, app.application.runtime.clock.now()]);
  await context.addCookies([viewer.cookie]);
  await openSurface(page, { path: `${projectPath}/logs`, selector: ".q-pdf-diagnostics" });
  const buttons = page.getByRole("button", { name: "Fix with AI", exact: true });
  expect(await buttons.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) expect(await button.isDisabled()).toBe(true);
  expect(provider.received).toHaveLength(0);
  expect(setup.errors).toEqual([]);
  await page.screenshot({ path: `${setup.evidence}/viewer.png` });
  await Bun.write(`${setup.evidence}/denials.json`, JSON.stringify({
    unconfigured: "AI_UNCONFIGURED", policy: "AI_POLICY_DENIED", disabled: "AI_DISABLED",
    viewerDisabledActions: await buttons.count(), providerRequests: provider.received.length,
  }, null, 2));
}, 180_000);

test("discards a genuine late diagnostic proposal after another mounted editor changes source", async () => {
  await using setup = await diagnosticFixture();
  const { app, page, context, provider } = setup;
  const original = await brokenDiagnostic(setup);
  const selected = await surfaceSignal(page, '.qa-assistant [aria-label="Selected diagnostic"]');
  await original.card.getByRole("button", { name: "Fix with AI", exact: true }).click();
  await selected.observed;
  await consent(page);
  await page.getByLabel("Send the selected diagnostic and its recorded log excerpt").check();
  provider.respond(request => {
    const file = request.files[0];
    if (!file) throw new TypeError("Selected diagnostic file required");
    const from = file.text.indexOf(command);
    return { text: "Late suggestion", patches: [{
      fileId: file.id, path: file.path, from, to: from + command.length, before: command, after: "% stale fix",
    }], citations: [] };
  });
  const gate = provider.gate();
  const requests = new Map<Request, { url: string; method: string; status: number | null; finished: boolean; failure: string | null }>();
  context.on("request", request => requests.set(request, {
    url: request.url(), method: request.method(), status: null, finished: false, failure: null,
  }));
  context.on("response", response => {
    const entry = requests.get(response.request());
    if (entry) entry.status = response.status();
  });
  context.on("requestfinished", request => {
    const entry = requests.get(request);
    if (entry) entry.finished = true;
  });
  context.on("requestfailed", request => {
    const entry = requests.get(request);
    if (entry) entry.failure = request.failure()?.errorText ?? "Unknown request failure";
  });
  try {
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await gate.entered;
    const collaborator = await context.newPage();
    try {
      try {
        await openSurface(collaborator, { path: `${projectPath}/edit`, selector: sourceSelector });
      } catch (error) {
        await Bun.write(`${setup.evidence}/collaborator-requests.json`, JSON.stringify([...requests.values()], null, 2));
        await Bun.write(`${setup.evidence}/collaborator-failed.html`, await collaborator.content());
        await collaborator.screenshot({ path: `${setup.evidence}/collaborator-failed.png` });
        throw error;
      }
      using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
        && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
      await collaborator.getByRole("textbox", { name: "Source: main.tex", exact: true }).click();
      await collaborator.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+End");
      await Promise.all([saved.promise, collaborator.keyboard.insertText("\n% newer collaborator context\n")]);
      const changed = await projectDocument(context, scope);
      expect(changed.text).toBe(original.broken + "\n% newer collaborator context\n");
      const discarded = waitForRenderedText(page, "Discarded the late proposal");
      gate.release();
      await discarded;
      expect(await page.getByRole("region", { name: "Proposed changes", exact: true }).count()).toBe(0);
      expect((await projectDocument(context, scope)).text).toBe(changed.text);
      expect(provider.received).toHaveLength(1);
      await page.getByText("Diagnostic source changed. Discarded the late proposal; recompile and choose a fresh diagnostic.", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${setup.evidence}/late-proposal-discarded.png` });
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await waitForRenderedText(page, "Recompile and choose a fresh diagnostic");
      expect(provider.received).toHaveLength(1);
      expect(setup.errors).toEqual([]);
      await Bun.write(`${setup.evidence}/stale.json`, JSON.stringify({
        diagnostic: original.diagnostic, revision: original.revision,
        providerContext: provider.contexts[0], finalText: changed.text, providerRequests: provider.received.length,
      }, null, 2));
    } finally { await collaborator.close(); }
  } finally { gate.release(); }
}, 180_000);
