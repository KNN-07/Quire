import { expect, test } from "bun:test";
import { fixtureIds } from "../../fixtures/foundation";
import { nextApplicationEvent, projectDocument, waitForRenderedText } from "../shared";
import { surfaceSignal } from "../assembly/actual-browser";
import { brokenDiagnostic, captureMatrix, command, consent, diagnosticFixture, scope, sourceSelector } from "./fixture";

test("opens a real diagnostic as consented exact context, reviews its fix and recompiles real PDF", async () => {
  await using setup = await diagnosticFixture();
  const { app, page, context, provider } = setup;
  const original = await brokenDiagnostic(setup);
  await captureMatrix(setup, "diagnostic");
  const selected = await surfaceSignal(page, '.qa-assistant [aria-label="Selected diagnostic"]');
  await original.card.getByRole("button", { name: "Fix with AI", exact: true }).click();
  await selected.observed;
  expect(await page.getByLabel("Tool", { exact: true }).inputValue()).toBe("error-fix");
  expect(await page.getByRole("button", { name: "Agent", exact: true }).getAttribute("aria-pressed")).toBe("true");
  expect(await page.getByLabel("Compile diagnostic", { exact: true }).inputValue()).toBe(original.diagnostic.id);
  expect(await page.getByLabel("Compile diagnostic", { exact: true }).isDisabled()).toBe(true);
  expect(await page.getByRole("group", { name: "Selected files" }).getByLabel("main.tex", { exact: true }).isChecked()).toBe(true);
  expect(await page.getByLabel("Send the selected diagnostic and its recorded log excerpt").isChecked()).toBe(false);
  expect(await page.getByRole("region", { name: "Selected diagnostic" }).innerText()).toContain(original.excerpt);
  expect(provider.received).toHaveLength(0);
  await captureMatrix(setup, "context");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "Choose and consent to a diagnostic first");
  expect(provider.received).toHaveLength(0);
  await page.getByLabel("Send the selected diagnostic and its recorded log excerpt").check();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "AI_CONSENT_REQUIRED");
  expect(provider.received).toHaveLength(0);
  await consent(page);
  provider.respond(request => {
    const file = request.files[0];
    if (!file || !file.text.includes(command)) throw new TypeError("Exact broken source required");
    const from = file.text.indexOf(command);
    return { text: "Remove the undefined command", patches: [{
      fileId: file.id, path: file.path, from, to: from + command.length, before: command, after: "% reviewed compiler fix",
    }], citations: [] };
  });
  const proposed = await surfaceSignal(page, ".qa-assistant__edit-actions button:not([disabled]):last-child");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await proposed.observed;
  expect(provider.contexts.at(-1)?.diagnostic).toBe(`${original.diagnostic.message}\n${original.excerpt}`);
  expect(provider.contexts.at(-1)?.files).toEqual([{
    id: fixtureIds.mainFile, path: "main.tex", from: 0, to: original.broken.length, text: original.broken,
  }]);
  expect((await projectDocument(context, scope)).text).toBe(original.broken);
  expect(await page.getByRole("button", { name: "Open source", exact: true }).isEnabled()).toBe(true);
  await captureMatrix(setup, "proposal");
  const linkedSource = await surfaceSignal(page, sourceSelector);
  const retainedReview = await surfaceSignal(page, ".qe-assistant .qa-assistant__review");
  await page.getByRole("button", { name: "Open source", exact: true }).click();
  await Promise.all([linkedSource.observed, retainedReview.observed]);
  expect((await projectDocument(context, scope)).text).toBe(original.broken);
  await page.screenshot({ path: `${setup.evidence}/source-linked-unaccepted.png` });
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await waitForRenderedText(page, "Accepted 1 edits");
  const fixed = await projectDocument(context, scope);
  expect(fixed.text).toBe(original.broken.replace(command, "% reviewed compiler fix"));
  using compiled = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === fixtureIds.project && event.payload.status === "succeeded", 90_000);
  await page.getByRole("button", { name: "Recompile accepted fix", exact: true }).click();
  await compiled.promise;
  // Follow the actual proposal source link back to the mounted editor and its retained PDF.
  const source = await surfaceSignal(page, sourceSelector);
  await page.getByRole("button", { name: "Open source", exact: true }).click();
  await source.observed;
  await page.getByRole("tab", { name: "PDF", exact: true }).click();
  const rendered = await surfaceSignal(page, 'canvas[data-rendered="true"]', 120_000);
  await rendered.observed;
  expect((await projectDocument(context, scope)).text).toBe(fixed.text);
  expect(setup.errors).toEqual([]);
  await page.screenshot({ path: `${setup.evidence}/accepted-real-pdf.png` });
  await Bun.write(`${setup.evidence}/workflow.json`, JSON.stringify({
    diagnostic: original.diagnostic, revision: original.revision, excerpt: original.excerpt,
    providerContext: provider.contexts.at(-1), before: original.broken, after: fixed.text, version: fixed.file.version,
  }, null, 2));
  const cleared = await surfaceSignal(page, '.qa-assistant select[aria-label="Tool"]:has(option[value="chat"]:checked)');
  await page.getByRole("button", { name: "Clear diagnostic context", exact: true }).click();
  await cleared.observed;
  expect(await page.getByLabel("Tool", { exact: true }).inputValue()).toBe("chat");
  expect(await page.getByLabel("Compile diagnostic", { exact: true }).isEnabled()).toBe(true);
  expect(await page.getByRole("region", { name: "Selected diagnostic" }).count()).toBe(0);
}, 180_000);
