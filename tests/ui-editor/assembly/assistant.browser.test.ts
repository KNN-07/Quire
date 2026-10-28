import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, nextApplicationEvent, projectDocument, waitForRenderedText } from "../shared";
import { openSurface, surfaceSignal } from "./actual-browser";
import { assemblyAssistant } from "./assistant-fixture";

const projectPath = `/projects/${fixtureIds.project}`;
const scope = { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" };
const sourceSelector = '.qe-main .cm-content[contenteditable="true"]';
test("consents to an actual compiler diagnostic and applies an ErrorFix before recompiling the saved source", async () => {
  // Given actual source with a genuine compiler error and the assembled shared controller.
  await using setup = await assemblyAssistant();
  const { app, context, page, provider } = setup;
  await openSurface(page, { path: `${projectPath}/edit`, selector: sourceSelector });
  const initial = await projectDocument(context, scope);
  const broken = initial.text.replace("\\end{document}", "\\AssemblyUndefinedControl\n\\end{document}");
  using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
    && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+A");
  await Promise.all([saved.promise, page.keyboard.insertText(broken)]);
  using failed = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === fixtureIds.project && event.payload.status === "failed", 90_000);
  const diagnosticReady = await surfaceSignal(page, '.qa-assistant select[aria-label="Compile diagnostic"]:has(option[value]:not([value=""]))');
  await page.getByRole("button", { name: "Recompile", exact: true }).click();
  await failed.promise;
  await page.locator(".qa-assistant__context summary").click();
  await diagnosticReady.observed;
  const previewResponse = await context.request.get(`/api/projects/${fixtureIds.project}/compile-preview`, { params: { branch: "main" } });
  const preview = editorValue(resultSchema(endpoints.compilePreview.output).parse(await previewResponse.json()));
  const diagnostic = preview.job?.diagnostics.find(entry => entry.message.includes("Undefined control sequence"));
  const log = preview.job?.artifacts.find(entry => entry.kind === "log");
  if (!diagnostic || !log) throw new TypeError("Actual failed job must publish its diagnostic and log");
  const logResponse = await context.request.get(`/api/artifacts/${log.id}/content`);
  const bytes = await logResponse.body();
  await page.locator(".qa-assistant__settings summary").click();
  await page.getByLabel("I consent to these provider terms").check();
  const consented = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === endpoints.aiConsent.path);
  await page.getByRole("button", { name: "Save consent decision" }).click();
  expect((await consented).ok()).toBe(true);
  await waitForRenderedText(page, "Consent accepted");
  await page.locator(".qa-assistant__settings summary").click();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByLabel("Tool", { exact: true }).selectOption("error-fix");
  await page.getByRole("group", { name: "Selected files" }).getByLabel("main.tex", { exact: true }).check();
  await page.getByLabel("Compile diagnostic", { exact: true }).selectOption(diagnostic.id);
  await page.getByLabel("Message the assistant").fill("Fix only the selected compiler error");
  // Diagnostic selection alone never transmits source or its recorded log excerpt.
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "Choose and consent to a diagnostic first");
  expect(provider.received).toHaveLength(0);
  provider.respond(request => {
    const file = request.files[0];
    if (!file) throw new TypeError("Explicit source context is required");
    const before = "\\AssemblyUndefinedControl";
    const from = file.text.indexOf(before);
    if (from < 0) throw new TypeError("Real failed command is missing");
    return { text: "Remove the undefined command", patches: [{
      fileId: file.id, path: file.path, from, to: from + before.length, before, after: "% reviewed compiler fix",
    }], citations: [] };
  });
  await page.getByLabel("Send the selected diagnostic and its recorded log excerpt").check();
  const proposed = await surfaceSignal(page, ".qa-assistant__review");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await proposed.observed;
  expect(provider.contexts.at(-1)?.diagnostic).toBe(`${diagnostic.message}\n${new TextDecoder().decode(bytes.subarray(diagnostic.rawStart, diagnostic.rawEnd))}`);
  expect((await projectDocument(context, scope)).text).toBe(broken);
  // When actual review acceptance publishes a fresh source epoch and ErrorFix recompiles it.
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await waitForRenderedText(page, "Accepted 1 edits");
  const fixed = await projectDocument(context, scope);
  expect(fixed.text).toBe(broken.replace("\\AssemblyUndefinedControl", "% reviewed compiler fix"));
  const fresh = await surfaceSignal(page, sourceSelector);
  await fresh.observed;
  using compiled = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === fixtureIds.project && event.payload.status === "succeeded", 90_000);
  const rendered = await surfaceSignal(page, 'canvas[data-rendered="true"]', 120_000);
  await page.getByRole("button", { name: "Recompile accepted fix", exact: true }).click();
  await Promise.all([compiled.promise, rendered.observed]);
  // Then the native job succeeds, the browser renders its actual PDF and source stays exact.
  expect((await projectDocument(context, scope)).text).toBe(fixed.text);
  expect(setup.errors).toEqual([]);
  await page.screenshot({ path: `${setup.evidence}/error-fix-compiled.png` });
  await Bun.write(`${setup.evidence}/diagnostic.json`, JSON.stringify({ diagnostic, providerContext: provider.contexts.at(-1) }, null, 2));
}, 180_000);

test("displays retrieved publication provenance and opens a different proposed source file from the actual agent route", async () => {
  // Given actual provider configuration and explicitly consented citation retrieval.
  await using setup = await assemblyAssistant();
  const { app, owner, page, provider } = setup;
  const operator = await authenticateApi(app, "operator@quire.local");
  const configured = await operator.http.put("api/admin/providers/crossref", { headers: { "if-match": '"0"' }, json: {
    baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: 0,
  } });
  expect(configured.status).toBe(200);
  const prefsResponse = await owner.http.get("api/me/preferences");
  const prefs = editorValue(resultSchema(endpoints.preferencesGet.output).parse(await prefsResponse.json()));
  const patched = await owner.http.patch("api/me/preferences", { json: {
    citationWebSearch: true, citationProviders: ["crossref"], expectedVersion: prefs.version,
  } });
  expect(patched.status).toBe(200);
  await openSurface(page, { path: `${projectPath}/agent`, selector: ".qe-route .qa-assistant textarea" });
  await page.locator(".qa-assistant__settings summary").click();
  await page.getByLabel("I consent to these provider terms").check();
  await page.getByRole("button", { name: "Save consent decision" }).click();
  await waitForRenderedText(page, "Consent accepted");
  await page.locator(".qa-assistant__settings summary").click();
  provider.respond({ text: "Retrieved and verified", patches: [], citations: [{ provider: "crossref", providerId: "10.1234/verified" }] });
  await page.getByLabel("Tool", { exact: true }).selectOption("citation-reviewer");
  await page.getByLabel("Message the assistant").fill("Find sources about latent dynamics");
  const retrieved = await surfaceSignal(page, ".qa-assistant__source");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await retrieved.observed;
  // Then displayed publication data comes from the real retrieval publication, not model prose.
  expect(provider.contexts.at(-1)?.publications).toHaveLength(1);
  expect(await page.getByRole("region", { name: "Retrieved publications" }).locator("article").count()).toBe(1);
  expect(await page.locator(".qa-assistant__source").innerText()).toContain("10.1234/verified");
  await page.screenshot({ path: `${setup.evidence}/retrieved-publication.png` });
  // When a real proposal targets another existing file, Open source switches the actual authoring document.
  provider.respond(request => {
    const file = request.files[0];
    if (!file) throw new TypeError("Selected source file required");
    return { text: "Review the introduction", patches: [{
      fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% reviewed introduction\n",
    }], citations: [] };
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByLabel("Tool", { exact: true }).selectOption("texgpt");
  await page.locator(".qa-assistant__context summary").click();
  await page.getByRole("group", { name: "Selected files" }).getByLabel("sections/intro.tex", { exact: true }).check();
  const proposed = await surfaceSignal(page, ".qa-assistant__review");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await proposed.observed;
  const editable = await surfaceSignal(page, '.qe-main .cm-content[aria-label="Source: sections/intro.tex"][contenteditable="true"]');
  await page.getByRole("button", { name: "Open source", exact: true }).click();
  await editable.observed;
  expect(new URL(page.url()).pathname).toBe(`${projectPath}/edit`);
  const text = await page.getByRole("textbox", { name: "Source: sections/intro.tex", exact: true }).innerText();
  expect(text).not.toContain("% reviewed introduction");
  expect(setup.errors).toEqual([]);
  await page.screenshot({ path: `${setup.evidence}/opened-proposed-source.png` });
}, 150_000);
