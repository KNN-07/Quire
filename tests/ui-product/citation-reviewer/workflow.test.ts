import { expect, test } from "bun:test";
import { DigestSchema, endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { bibliographyKeys } from "../../../apps/web/src/features/editor/tools/insertion";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";
import { nextApplicationEvent, projectDocument, waitForRenderedText } from "../../ui-editor/shared";
import { consent } from "../../ui-editor/diagnostic-ai/fixture";
import { citationFixture, scope, source, unsupported } from "./fixture";

test("native consented review highlights exact source then explicitly copies and cites one retrieved publication", async () => {
  await using setup = await citationFixture();
  const { page, context, app, owner, provider, evidence } = setup;
  const path = `/projects/${scope.projectId}/edit`;
  await openSurface(page, { path, selector: '.qe-main .cm-content[contenteditable="true"]' });
  const original = await projectDocument(context, scope);
  const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await (await owner.http.get(
    `api/projects/${scope.projectId}/effective-access`, { searchParams: { branch: scope.branch } })).json()));
  const created = await owner.http.post(`api/projects/${scope.projectId}/files`, {
    headers: { "idempotency-key": crypto.randomUUID() }, json: {
      scope: { projectId: scope.projectId, branch: scope.branch }, path: "review.bib", kind: "file",
      text: "", expectedVersion: access.branchRevision,
    },
  });
  expect(created.status).toBe(200);
  const bib = editorValue(resultSchema(endpoints.fileCreate.output).parse(await created.json()));
  await openSurface(page, { path, selector: '.qe-main .cm-content[contenteditable="true"]' });
  using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
    && event.aggregateId === scope.projectId && event.payload.resourceId === scope.fileId);
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).click();
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
  await saved.promise;
  const baseline = await projectDocument(context, scope);
  await consent(page);
  await page.locator(".qa-assistant__settings summary").click();
  await page.getByLabel("Consent to citation web retrieval").check();
  await page.getByLabel("Citation providers (comma-separated)").fill("crossref");
  await page.getByRole("button", { name: "Save AI preferences", exact: true }).click();
  await waitForRenderedText(page, "AI preferences saved");
  await page.locator(".qa-assistant__settings summary").click();
  await page.getByLabel("Tool", { exact: true }).selectOption("citation-reviewer");
  await page.locator(".qa-assistant__context summary").click();
  await page.getByRole("checkbox", { name: "main.tex", exact: true }).check();
  await page.getByLabel("Message the assistant").fill("Assess the two claims against retrieved publications.");
  using completed = nextApplicationEvent(app, event => event.topic === "operation.changed" && event.payload.status === "succeeded");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const terminal = await completed.promise;
  await waitForRenderedText(page, "Unsupported · model assessment");
  const run = editorValue(resultSchema(endpoints.aiRunGet.output).parse(await (await context.request.get(`/api/ai/runs/${terminal.aggregateId}`)).json()));
  expect(run.status).toBe("succeeded"); expect(run.proposals).toHaveLength(0);
  expect(run.findings).toHaveLength(2); expect(provider.contexts).toHaveLength(1);
  expect(provider.contexts[0]?.publications).toHaveLength(1);
  expect((await projectDocument(context, scope)).text).toBe(baseline.text);
  const claim = page.locator(".qa-assistant__claims article").filter({ hasText: unsupported });
  await claim.getByRole("button", { name: "Highlight claim", exact: true }).click();
  await waitForRenderedText(page, "Highlighted exact UTF-16 range");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(unsupported);
  await page.screenshot({ path: `${evidence}/source-highlight.png` });
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ArrowRight");
  const publication = run.sources[0];
  const key = publication && bibliographyKeys(publication.bibtex)[0]?.key;
  if (!publication || !key) throw new TypeError("Actual retrieved publication/key required");
  await page.getByLabel("Publication to copy").selectOption(`${publication.provider}:${publication.providerId}`);
  await page.getByLabel("Editable bibliography").selectOption(bib.id);
  const trackingBlocked = await surfaceSignal(page, ".qa-assistant__claims > .qa-assistant__row > button:disabled");
  await page.getByRole("button", { name: "Track changes off", exact: true }).click();
  await trackingBlocked.observed;
  expect(await page.getByRole("button", { name: "Copy publication", exact: true }).isDisabled()).toBe(true);
  expect(await page.getByRole("button", { name: "Cite publication", exact: true }).isDisabled()).toBe(true);
  expect((await projectDocument(context, scope)).text).toBe(baseline.text);
  const trackingPaused = await surfaceSignal(page, ".qa-assistant__claims > .qa-assistant__row > button:not([disabled])");
  await page.getByRole("button", { name: "Track changes on", exact: true }).click();
  await trackingPaused.observed;
  const copied = page.waitForResponse(response => response.url().includes(`/projects/${scope.projectId}/citations`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Copy publication", exact: true }).click();
  expect((await copied).status()).toBe(200);
  await waitForRenderedText(page, `Copied ${key} to review.bib. Source was not changed.`);
  expect((await projectDocument(context, scope)).text).toBe(baseline.text);
  expect((await projectDocument(context, { ...scope, fileId: bib.id })).text).toContain(publication.bibtex);
  // Copy can advance the source epoch via a structural commit. Obtain a current review explicitly.
  using reviewed = nextApplicationEvent(app, event => event.topic === "operation.changed" && event.payload.status === "succeeded");
  await page.getByRole("button", { name: "Regenerate (new use)", exact: true }).click();
  const regenerated = await reviewed.promise;
  await waitForRenderedText(page, regenerated.aggregateId);
  await waitForRenderedText(page, "Unsupported · model assessment");
  await page.locator(".qa-assistant__claims article").filter({ hasText: unsupported }).getByRole("button", { name: "Highlight claim", exact: true }).click();
  await waitForRenderedText(page, "Highlighted exact UTF-16 range");
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ArrowRight");
  await page.getByLabel("Publication to copy").selectOption(`${publication.provider}:${publication.providerId}`);
  await page.getByLabel("Editable bibliography").selectOption(bib.id);
  const held = setup.holdCitation();
  try {
    await page.getByRole("button", { name: "Cite publication", exact: true }).click();
    await held.entered;
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("Home");
  } finally { held.release(); }
  await waitForRenderedText(page, "citation insertion or workspace refresh was not acknowledged");
  expect((await projectDocument(context, scope)).text).toBe(baseline.text);
  expect((await projectDocument(context, { ...scope, fileId: bib.id })).text).toContain(publication.bibtex);
  await page.locator(".qa-assistant__claims article").filter({ hasText: unsupported }).getByRole("button", { name: "Highlight claim", exact: true }).click();
  await waitForRenderedText(page, "Highlighted exact UTF-16 range");
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ArrowRight");
  using cited = nextApplicationEvent(app, event => event.topic === "document.saved"
    && event.aggregateId === scope.projectId && event.payload.resourceId === scope.fileId);
  await page.getByRole("button", { name: "Cite publication", exact: true }).click();
  await cited.promise;
  await waitForRenderedText(page, `and saved \\cite{${key}} in main.tex.`);
  const after = await projectDocument(context, scope);
  expect(after.text).toBe(source.replace(unsupported, `${unsupported}\\cite{${key}}`));
  expect(await page.locator(".qa-assistant__claims article").filter({ hasText: unsupported })
    .getByRole("button", { name: "Highlight claim", exact: true }).isDisabled()).toBe(true);
  await openSurface(page, { path, selector: '.qe-main .cm-content[contenteditable="true"]' });
  expect((await projectDocument(context, scope)).text).toBe(after.text);
  using compiled = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === scope.projectId && ["succeeded", "failed"].includes(event.payload.status), 90_000);
  await page.getByRole("button", { name: "Recompile", exact: true }).click();
  await compiled.promise;
  const preview = editorValue(resultSchema(endpoints.compilePreview.output).parse(await (await context.request.get(
    `/api/projects/${scope.projectId}/compile-preview`, { params: { branch: scope.branch } })).json()));
  expect(preview.job?.status).toBe("succeeded");
  expect(preview.job?.artifacts.some(item => item.kind === "pdf")).toBe(true);
  expect(preview.job?.diagnostics).toEqual([]);
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
  await page.getByRole("button", { name: "Warnings (0)", exact: true }).waitFor({ state: "visible" });
  expect(await page.locator(".q-pdf-diagnostics").count()).toBe(0);
  await page.screenshot({ path: `${evidence}/final-pass-diagnostics.png`, fullPage: true });
  await page.getByRole("tab", { name: "PDF", exact: true }).click();
  for (const artifact of preview.job?.artifacts ?? []) {
    const bytes = await (await context.request.get(`/api/artifacts/${artifact.id}/content`)).body();
    await Bun.write(`${evidence}/artifact-${artifact.id}-${artifact.kind}`, bytes);
  }
  const providerReceipts = await app.application.runtime.db.all("SELECT id,provider_request_id,status FROM ai_runs WHERE id IN (?,?)",
    [run.id, regenerated.aggregateId]);
  const provenance = await app.application.runtime.db.all<{ provider: string; provider_id: string; response_digest: string; endpoint: string }>(
    "SELECT provider,provider_id,response_digest,endpoint FROM reference_provenance WHERE owner_id=?", [owner.user.id]);
  for (const item of provenance) {
    await Bun.write(`${evidence}/retrieved-${item.response_digest}.json`,
      await app.application.runtime.blobs.get(DigestSchema.parse(item.response_digest)));
  }
  const proof = { utc: new Date().toISOString(), run, regeneratedRunId: regenerated.aggregateId, fileId: scope.fileId,
    providerReceipts, provenance,
    targetFileId: bib.id, originalHash: new Bun.CryptoHasher("sha256").update(original.text).digest("hex"),
    beforeHash: new Bun.CryptoHasher("sha256").update(baseline.text).digest("hex"),
    afterHash: new Bun.CryptoHasher("sha256").update(after.text).digest("hex"), before: baseline.text, after: after.text, publication, key, compile: preview.job };
  await Bun.write(`${evidence}/workflow.json`, JSON.stringify(proof, null, 2));
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async value => {
      document.documentElement.dataset["theme"] = value;
      await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, theme);
    if (!await page.getByRole("region", { name: "Assistant", exact: true }).isVisible()) {
      await page.getByRole("button", { name: "Assistant", exact: true }).last().click();
    }
    const visible = await surfaceSignal(page, ".qa-assistant__claims article");
    await visible.observed;
    await page.getByLabel("Publication to copy").selectOption(`${publication.provider}:${publication.providerId}`);
    await page.getByLabel("Editable bibliography").selectOption(bib.id);
    await page.locator(".qa-assistant__claims article").filter({ hasText: unsupported }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/review-${width}-${theme}.png` });
    await page.getByRole("button", { name: "Copy publication", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/publication-${width}-${theme}.png` });
  }
  expect(setup.errors).toEqual([]);
}, 240_000);
