import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticatedContext, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser } from "../../ui-editor/shared";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";

const evidence = fileURLToPath(new URL(`../../../docs/evidence/p56-tables/runs/${crypto.randomUUID()}/`, import.meta.url));
const sourceSelector = '.qe-main .cm-content[contenteditable="true"]';
const inputs = [
  "apps/web/src/features/editor/visual/VisualPanel.tsx",
  "apps/web/src/features/editor/visual/Nodes.tsx",
  "apps/web/src/features/editor/visual/structures.ts",
  "apps/web/src/features/editor/index.tsx",
  "apps/web/src/features/editor/session-controller.ts",
  "apps/web/src/features/editor/source/SourcePanel.tsx",
  "apps/web/src/features/editor/pdf/panel.tsx",
  "services/compiler/index.ts",
  "tests/ui-editor/shared/application.ts",
  "tests/ui-editor/shared/web-server.mjs",
  "tests/ui-product/table-composition/native-table.test.ts",
];
const base = "\\documentclass{article}\n\\begin{document}\nTable composition proof.\n\nControlled TSV follows.\n\\end{document}\n";
const tsv = "Item\tCount\nApples\t17\nIntentionally empty\t";

test("native supported visual tables persist, round-trip through Source, and compile to a real PDF", async () => {
  await mkdir(evidence, { recursive: true });
  console.info("P56_EVIDENCE", evidence);
  const actions: unknown[] = [];
  const record = async (action: string, detail: unknown) => {
    const entry = { utc: new Date().toISOString(), action, detail };
    actions.push(entry);
    console.info("P56", JSON.stringify(entry));
    await Bun.write(`${evidence}/actions.json`, JSON.stringify(actions, null, 2));
  };
  const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [
    path, new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex"),
  ])));
  await Bun.write(`${evidence}/inputs-pre.json`, JSON.stringify(await hashes(), null, 2));
  await record("runtime", { cwd: process.cwd(), version: Bun.version, executable: process.execPath,
    command: "PATH=\"$PWD/node_modules/.bin:$PATH\" ./node_modules/.bin/bun test tests/ui-product/table-composition/native-table.test.ts" });
  const resources = new AsyncDisposableStack();
  let root: string | undefined;
  try {
    const app = await startEditorApplication();
    root = app.dataDir;
    resources.defer(() => app[Symbol.asyncDispose]());
    const browser = await startEditorBrowser();
    resources.defer(() => browser[Symbol.asyncDispose]());
    await record("owned", { web: app.url.origin, api: app.apiUrl.origin, root });
    const actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 1000 } });
    resources.defer(() => actor[Symbol.asyncDispose]());
    const page = await actor.context.newPage();
    page.on("pageerror", error => { console.error("P56_PAGEERROR", error); });
    page.on("response", response => {
      if (new URL(response.url()).pathname.startsWith("/api/")) {
        console.info("P56_API", response.request().method(), response.status(), response.url());
      }
    });
    const scope = { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" };
    const original = await projectDocument(actor.context, scope);
    await Bun.write(`${evidence}/original-input.tex`, original.text);
    await openSurface(page, { path: `/projects/${fixtureIds.project}/edit`, selector: sourceSelector });
    const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    const save = async (action: string, trigger: () => Promise<unknown>) => {
      using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
        && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
      await trigger();
      const event = await saved.promise;
      const document = await projectDocument(actor.context, scope);
      await record(action, { event, revision: document.file.version, source: document.text });
      return document;
    };
    await save("prepare-owned-native-source", async () => {
      await source.press("ControlOrMeta+a");
      await page.keyboard.insertText(base);
    });
    const modes = page.getByRole("group", { name: "Workspace layout", exact: true });
    const visual = await surfaceSignal(page, ".q-visual-body textarea");
    await Promise.all([visual.observed, modes.getByRole("button", { name: "Visual", exact: true }).click()]);
    const paragraph = page.getByRole("textbox", { name: "Paragraph text", exact: true }).filter({ hasText: "Table composition proof." });
    await paragraph.focus();
    await paragraph.press("ControlOrMeta+End");
    await save("insert-supported-table-button", () => page.getByRole("button", { name: "Table", exact: true }).click());
    const first = page.locator(".q-visual-table").first();
    for (const [label, value] of [
      ["Row 1 column 1", "Region"], ["Row 1 column 2", "Score"],
      ["Row 2 column 1", "North"], ["Row 2 column 2", "42"],
    ]) {
      if (!label || !value) throw new TypeError("Incomplete cell fixture");
      await save(`cell-${label}`, () => first.getByRole("textbox", { name: label, exact: true }).fill(value));
    }
    await save("supported-column-alignment", () => first.getByRole("textbox", { name: "Column alignment", exact: true }).fill("lr"));
    const target = page.getByRole("textbox", { name: "Paragraph text", exact: true }).filter({ hasText: "Controlled TSV follows." });
    await target.focus();
    await target.press("ControlOrMeta+End");
    await save("paste-rectangular-tsv", () => target.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, tsv));
    expect(await page.locator(".q-visual-table").count()).toBe(2);
    expect(await page.locator(".q-visual-table").nth(1).getByRole("textbox", { name: "Row 3 column 2", exact: true }).inputValue()).toBe("");
    await Bun.write(`${evidence}/controlled-input.tsv`, tsv);
    const sourceReady = await surfaceSignal(page, sourceSelector);
    await Promise.all([sourceReady.observed, modes.getByRole("button", { name: "Source", exact: true }).click()]);
    const beforeEdit = await projectDocument(actor.context, scope);
    expect(beforeEdit.text).toContain("North & 42");
    const finalText = beforeEdit.text.replace("North & 42", "North & 84");
    await save("source-table-cell-edit", async () => {
      await source.press("ControlOrMeta+a");
      await page.keyboard.insertText(finalText);
    });
    const reloaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/files/${fixtureIds.mainFile}/document`));
    await page.reload({ waitUntil: "domcontentloaded" });
    const received = editorValue(resultSchema(endpoints.fileDocument.output).parse(await (await reloaded).json()));
    expect(received.text).toBe(finalText);
    await record("reload", received);
    await Bun.write(`${evidence}/compiled-source.tex`, finalText);
    const sourceLoaded = await surfaceSignal(page, sourceSelector);
    await sourceLoaded.observed;
    using completed = nextApplicationEvent(app, event => event.topic === "job.changed"
      && event.aggregateId === fixtureIds.project && event.payload.status === "succeeded", 120_000);
    const rendered = await surfaceSignal(page, 'canvas[data-rendered="true"]', 120_000);
    await Promise.all([completed.promise, rendered.observed,
      page.getByRole("button", { name: "Recompile", exact: true }).click()]);
    const response = await actor.context.request.get(`/api/projects/${fixtureIds.project}/compile-preview`, { params: { branch: "main" } });
    const preview = editorValue(resultSchema(endpoints.compilePreview.output).parse(await response.json()));
    expect(preview.job?.status).toBe("succeeded");
    if (!preview.job || !preview.preview) throw new TypeError("Successful compilation has no published artifact");
    const persisted = await projectDocument(actor.context, scope);
    expect(preview.preview.snapshot.revision).toBe(persisted.file.version.revision);
    const artifact = await actor.context.request.get(`/api/artifacts/${preview.preview.artifact.id}/content`);
    expect(artifact.status()).toBe(200);
    const bytes = await artifact.body();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await Bun.write(`${evidence}/table-output.pdf`, bytes);
    await record("real-compile-and-artifact", { previewStatus: response.status(), preview,
      event: await completed.promise, artifactStatus: artifact.status(), artifactHeaders: artifact.headers(),
      bytes: bytes.length, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), source: persisted });
    for (const artifactEntry of preview.job.artifacts.filter(entry => entry.kind === "log" || entry.name === "output.log")) {
      const log = await actor.context.request.get(`/api/artifacts/${artifactEntry.id}/content`);
      expect(log.status()).toBe(200);
      await Bun.write(`${evidence}/${artifactEntry.name}`, await log.body());
    }
    const extracted = Bun.spawn(["pdftotext", "-layout", `${evidence}/table-output.pdf`, "-"], { stdout: "pipe", stderr: "pipe" });
    const [pdfText, extractionErrors, extractionExit] = await Promise.all([
      new Response(extracted.stdout).text(), new Response(extracted.stderr).text(), extracted.exited,
    ]);
    await Bun.write(`${evidence}/pdf-text.txt`, pdfText);
    await record("pdf-text-extraction", { command: `pdftotext -layout ${evidence}/table-output.pdf -`, exit: extractionExit, stderr: extractionErrors });
    expect(extractionExit).toBe(0);
    for (const value of ["Region", "Score", "North", "84", "Item", "Count", "Apples", "17", "Intentionally empty"]) {
      expect(pdfText).toContain(value);
    }
    expect(pdfText).not.toMatch(/\b42\b/);
    const actualPaper = await surfaceSignal(page, `[data-artifact-id="${preview.preview.artifact.id}"] canvas[data-rendered="true"]`);
    await actualPaper.observed;
    for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
      await using capture = await authenticatedContext(browser, app, {
        viewport: { width, height: width === 390 ? 844 : 1000 },
        colorScheme: theme === "light" ? "light" : "dark",
      });
      const capturePage = await capture.context.newPage();
      await openSurface(capturePage, { path: `/projects/${fixtureIds.project}/edit`, selector: sourceSelector });
      await capturePage.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
      const captureModes = capturePage.getByRole("group", { name: "Workspace layout", exact: true });
      for (const [layout, label] of [["visual", "Visual"], ["source", "Source"], ["pdf", "PDF"]]) {
        if (!layout || !label) throw new TypeError("Incomplete layout fixture");
        const changed = await surfaceSignal(capturePage, `.qe-panes[data-layout="${layout}"]`);
        await Promise.all([changed.observed, captureModes.getByRole("button", { name: label, exact: true }).click()]);
        if (layout === "visual") {
          const visible = await surfaceSignal(capturePage, ".q-visual-table textarea");
          await visible.observed;
        }
        if (layout === "pdf") {
          const visible = await surfaceSignal(capturePage, `[data-artifact-id="${preview.preview.artifact.id}"] canvas[data-rendered="true"]`);
          await visible.observed;
        }
        await capturePage.screenshot({ path: `${evidence}/${layout}-${width}-${theme}.png` });
        if (layout === "visual") {
          await capturePage.locator(".q-visual-table").last().scrollIntoViewIfNeeded();
          await capturePage.screenshot({ path: `${evidence}/tsv-controls-${width}-${theme}.png` });
        }
        expect(await capturePage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await record("capture", { layout, width, theme,
          overflow: await capturePage.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
      }
    }
    await record("chain-complete", { revision: persisted.file.version, job: preview.job.id, artifact: preview.preview.artifact.id });
  } finally {
    await resources.disposeAsync();
    await Bun.write(`${evidence}/inputs-post.json`, JSON.stringify(await hashes(), null, 2));
    await record("cleanup", { root, rootRemoved: root ? await stat(root).then(() => false, () => true) : true,
      resources: "Authenticated browser context, browser, application, native API, Vite and ephemeral application storage disposed." });
  }
}, 240_000);
