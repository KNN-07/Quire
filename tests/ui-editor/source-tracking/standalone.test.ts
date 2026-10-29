import { expect, test } from "bun:test";
import { access, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Request } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import { surfaceSignal } from "../assembly/actual-browser";
import type * as Harness from "./standalone";

test("standalone source controls and emulated undo stay on a private binding", async () => {
  const directory = fileURLToPath(new URL("./build", import.meta.url));
  const evidence = fileURLToPath(new URL(`../../../docs/evidence/p31-source-tracking/standalone-${crypto.randomUUID()}`, import.meta.url));
  const entry = "/@fs" + fileURLToPath(new URL("./build/standalone.js", import.meta.url));
  const html = "/@fs" + fileURLToPath(new URL("./standalone.html", import.meta.url));
  await mkdir(evidence, { recursive: true });
  const resources = new AsyncDisposableStack();
  let ownedRoot = "";
  resources.defer(() => rm(directory, { force: true, recursive: true }));
  try {
    const build = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./standalone.tsx", import.meta.url))],
      outdir: directory, target: "browser", minify: true,
      define: { "process.env.NODE_ENV": "\"production\"" },
    });
    if (!build.success) throw new AggregateError(build.logs, "Standalone build failed");
    const app = resources.use(await startEditorApplication());
    ownedRoot = app.dataDir;
    const browser = resources.use(await startEditorBrowser());
    const actor = resources.use(await authenticatedContext(browser, app));
    const page = await actor.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const bindings of ["default", "vim", "emacs"] as const) {
      const sessionResponse = await actor.context.request.get("/api/me");
      const account = editorValue(resultSchema(endpoints.me.output).parse(await sessionResponse.json()));
      const response = await actor.context.request.patch(endpoints.preferencesPatch.path, {
        headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken },
        data: { expectedVersion: account.preferences.version, bindings },
      });
      expect(response.status()).toBe(200);
      await page.goto(`${html}?project=${ids.project}`, { waitUntil: "domcontentloaded" });
      await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.ready; }, entry);
      const toggle = page.getByRole("button", { name: "Track changes off", exact: true });
      if (await toggle.count()) {
        const ready = await surfaceSignal(page, '.q-source-tracking button:not([disabled])');
        await ready.observed;
        await toggle.click();
      }
      const editable = await surfaceSignal(page, '.cm-content[contenteditable="true"]');
      await editable.observed;
      const before = await projectDocument(actor.context, { projectId: ids.project, branch: "main", fileId: ids.mainFile });
      const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
      await source.click();
      if (bindings === "vim") await source.press("i");
      await page.keyboard.insertText("PRIVATE_UNDO");
      expect(await page.evaluate(async path => { const harness: typeof Harness = await import(path); return harness.binding().shared; }, entry)).toBe(false);
      if (bindings === "vim") { await source.press("Escape"); await source.press("u"); }
      else if (bindings === "emacs") { await source.press("Control+x"); await source.press("u"); }
      else await source.press("Control+z");
      const undone = await page.evaluate(async path => { const harness: typeof Harness = await import(path); return harness.binding(); }, entry);
      expect(undone.draft).toBe(before.text);
      expect(undone.source).toBe(before.text);
      // External/structural callers cannot reach their subsequent direct package edit.
      const denied = await page.evaluate(async path => {
        const harness: typeof Harness = await import(path);
        try { harness.insert("\\includegraphics{unreviewed}"); return ""; }
        catch (error) { if (!(error instanceof Error)) throw error; return error.message; }
      }, entry);
      expect(denied).toContain("unavailable");
      if (bindings === "default") {
        const fileRequest = { params: { branch: "main" } };
        const treeBefore = editorValue(resultSchema(endpoints.filesList.output).parse(await (
          await actor.context.request.get(`/api/projects/${ids.project}/files`, fileRequest)).json()));
        const bib = treeBefore.find(file => file.path === "refs.bib");
        if (!bib) throw new Error("Bibliography missing");
        const bibBefore = await projectDocument(actor.context, { projectId: ids.project, branch: "main", fileId: bib.id });
        const mutations: string[] = [];
        const recordMutation = (request: Request) => {
          if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith(`/api/projects/${ids.project}/`)) mutations.push(request.url());
        };
        page.on("request", recordMutation);
        const blocked = await page.evaluate(async path => {
          const harness: typeof Harness = await import(path); return harness.blockedMutations();
        }, entry);
        page.off("request", recordMutation);
        expect(blocked.results).toEqual([
          { operation: "citation-copy", code: "SOURCE_MUTATION_BLOCKED" },
          { operation: "upload", code: "SOURCE_MUTATION_BLOCKED" },
          { operation: "file-create", code: "SOURCE_MUTATION_BLOCKED" },
          { operation: "link", code: "SOURCE_MUTATION_BLOCKED" },
          { operation: "metadata-mutation", code: "SOURCE_MUTATION_BLOCKED" },
          { operation: "stale-handle-package", code: "Error" },
        ]);
        expect(blocked.sourceReadOnly).toBe(false);
        expect(blocked.source).toBe(before.text);
        expect(mutations).toEqual([]);
        expect((await projectDocument(actor.context, { projectId: ids.project, branch: "main", fileId: bib.id })).text).toBe(bibBefore.text);
        expect(editorValue(resultSchema(endpoints.filesList.output).parse(await (
          await actor.context.request.get(`/api/projects/${ids.project}/files`, fileRequest)).json()))).toEqual(treeBefore);
        await Bun.write(`${evidence}/prewrite-guard.json`, JSON.stringify({
          blocked, mutations, treeBefore,
          mainHash: new Bun.CryptoHasher("sha256").update(before.text).digest("hex"),
          bibliographyHash: new Bun.CryptoHasher("sha256").update(bibBefore.text).digest("hex"),
        }, null, 2));
        await page.getByRole("button", { name: "Code Check", exact: true }).click();
        await page.getByRole("button", { name: "Suppress this file", exact: true }).click();
        expect((await projectDocument(actor.context, { projectId: ids.project, branch: "main", fileId: ids.mainFile })).text).toBe(before.text);
        expect(await page.getByLabel("Retained proposal draft").inputValue()).toStartWith("% quire-check disable-file all");
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await source.click(); await source.press("Control+z");
        expect(await page.getByLabel("Retained proposal draft").count()).toBe(0);
        await source.evaluate(element => {
          const data = new DataTransfer(); data.items.add(new File(["unreviewed"], "image.png", { type: "image/png" }));
          element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        });
        expect(await page.getByRole("alert").innerText()).toContain("Image insertion is unavailable");
        for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
          await page.screenshot({ path: `${evidence}/standalone-${width}-${theme}.png` });
        }
      }
      await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.close(); }, entry);
    }
    expect(errors).toEqual([]);
    console.info("P31_STANDALONE_PASS", evidence);
  } finally {
    await resources.disposeAsync();
    const absent = ownedRoot ? await access(ownedRoot).then(() => false, () => true) : true;
    expect(absent).toBe(true);
    await Bun.write(`${evidence}/cleanup.json`, JSON.stringify({ root: ownedRoot, absent, removedBuild: directory }));
    console.info("P31_STANDALONE_CLEANED", { root: ownedRoot, absent, removedBuild: directory });
  }
}, 180_000);
