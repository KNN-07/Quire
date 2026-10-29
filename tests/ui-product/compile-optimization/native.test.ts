import { expect, test } from "bun:test";
import { mkdir, readFile, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { CoreProjects } from "../../../services/core/base";
import { ProbeReportSchema } from "../../../services/operations/environments/model";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { saveEnvironment } from "../../../services/operations/environments/registry";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser } from "../../ui-editor/shared";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";

test("native externalized assets survive cache clearing and rebuild without figure generation", async () => {
  const evidence = `docs/evidence/p66-compile-optimization/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root: string;
  {
    await using app = await startEditorApplication();
    await using browser = await startEditorBrowser();
    root = app.dataDir;
    const owner = await authenticateApi(app);
    const operator = await authenticateApi(app, "operator@quire.local");
    const runtime = app.application.runtime;
    const principal = await runtime.services.get("identity").require(new Request(app.url, {
      headers: { cookie: `${operator.cookie.name}=${operator.cookie.value}` },
    }));
    const report = ProbeReportSchema.parse(JSON.parse(await readFile(
      "docs/evidence/p2o-environments/restricted-report.json", "utf8")));
    const manifest = manifestFromProbe({ id: crypto.randomUUID(), label: "Pre-rendered figure proof", report });
    await saveEnvironment({ ...runtime, routes: runtime.routes.forLane("O") }, {
      manifest, report, actor: { id: operator.user.id, sessionId: principal.sessionId },
    });
    const source = String.raw`\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{external}
\tikzexternalize
\tikzset{external/system call={quire-tikz \image}}
\begin{document}
Persistent externalized figure.
\begin{tikzpicture}\node[draw] {QUIRECACHEDFIGURE};\end{tikzpicture}
\end{document}
`;
    const core = new CoreProjects({ ...runtime, routes: runtime.routes.forLane("K") });
    const project = await core.createFromFiles(owner.user.id, {
      name: "Pre-render and reuse", environmentId: manifest.id, mainPath: "main.tex",
      entries: [{ path: "main.tex", bytes: new TextEncoder().encode(source) }],
    });
    const scope = { projectId: project.id, branch: project.defaultBranch, fileId: project.settings.mainFileId };
    const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    console.info("P66_OWNED", { root, evidence, web: app.url.origin, api: app.apiUrl.origin, image: report.image });
    try {
      await context.addCookies([owner.cookie]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await openSurface(page, { path: `/projects/${project.id}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
      const compile = async () => {
        using done = nextApplicationEvent(app, event => event.topic === "job.changed"
          && event.aggregateId === project.id && ["succeeded", "failed", "timeout"].includes(event.payload.status), 120_000);
        await page.getByRole("button", { name: "Recompile", exact: true }).click();
        const event = await done.promise;
        if (event.topic !== "job.changed") throw new Error("Compiler event required");
        const job = await runtime.services.get("compiler").get(owner.user.id, event.payload.resourceId);
        await Bun.write(`${evidence}/${job.id}.json`, JSON.stringify(job, null, 2));
        expect(job.status).toBe("succeeded");
        return job;
      };
      const rendered = await compile();
      await openSurface(page, { path: `/projects/${project.id}/logs`, selector: ".q-pdf-log" });
      const names = ["output-figure0.pdf", "output-figure0.md5", "output-figure0.dpth"];
      const uploads: { name: string; mimeType: string; buffer: Buffer }[] = [];
      for (const name of names) {
        const artifact = rendered.artifacts.find(item => item.name === name);
        if (!artifact) throw new Error(`Missing actual externalized artifact: ${name}`);
        const downloaded = page.waitForEvent("download");
        await page.getByRole("button", { name: new RegExp(`^Download ${name.replaceAll(".", "\\.")} \\(`) }).click();
        const download = await downloaded;
        expect(download.suggestedFilename()).toBe(name);
        await download.saveAs(`${evidence}/${name}`);
        uploads.push({ name, mimeType: artifact.mime, buffer: await readFile(`${evidence}/${name}`) });
      }
      await openSurface(page, { path: `/projects/${project.id}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
      await page.getByText("File actions", { exact: true }).click();
      const uploaded = page.waitForResponse(response => response.request().method() === "POST"
        && response.url().endsWith(`/projects/${project.id}/uploads`));
      await page.getByLabel("Upload files", { exact: true }).setInputFiles(uploads);
      const files = editorValue(resultSchema(endpoints.filesUpload.output).parse(await (await uploaded).json()));
      expect(files.map(file => file.path).sort()).toEqual([...names].sort());
      const reused = source.replace("\\tikzexternalize", "\\tikzexternalize[mode=only graphics]")
        .replace("quire-tikz \\image", "false");
      using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
        && event.aggregateId === project.id && event.payload.resourceId === scope.fileId);
      const editor = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
      await editor.click(); await editor.press("ControlOrMeta+A"); await page.keyboard.insertText(reused); await saved.promise;
      await page.getByText("PDF options", { exact: true }).click();
      const cleared = page.waitForResponse(response => response.request().method() === "DELETE"
        && response.url().endsWith(`/projects/${project.id}/compile-cache`));
      await page.getByRole("button", { name: "Clear generated cache", exact: true }).click();
      expect((await cleared).status()).toBe(200);
      if (await page.locator(".q-pdf-options").evaluate(node => node.hasAttribute("open"))) {
        await page.getByText("PDF options", { exact: true }).click();
      }
      const rebuilt = await compile();
      for (const file of files) {
        const expected = uploads.find(upload => upload.name === file.path);
        if (!expected) throw new Error("Uploaded companion required");
        const actual = await context.request.get(`/api/projects/${project.id}/files/${file.id}/content?branch=main`);
        expect(await actual.body()).toEqual(expected.buffer);
      }
      expect((await projectDocument(context, scope)).text).toBe(reused);
      const output = rebuilt.artifacts.find(artifact => artifact.name === "output.txt");
      if (!output) throw new Error("Real PDF extraction required");
      expect(await (await context.request.get(`/api/artifacts/${output.id}/content`)).text()).toContain("QUIRECACHEDFIGURE");
      await openSurface(page, { path: `/projects/${project.id}/logs`, selector: ".q-pdf-log" });
      await page.getByText("Compile optimization", { exact: true }).click();
      for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
        await page.getByText("Reuse pre-rendered TikZ figures", { exact: true }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `${evidence}/guidance-${width}-${colorScheme}.png` });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole("tab", { name: "PDF", exact: true }).click();
      await (await surfaceSignal(page, 'canvas[data-rendered="true"]', 120_000)).observed;
      await page.screenshot({ path: `${evidence}/reused-real-pdf.png` });
      expect(errors).toEqual([]);
      await Bun.write(`${evidence}/receipt.json`, JSON.stringify({ root, project, manifest, rendered, rebuilt, files, source, reused, errors }, null, 2));
    } finally { await context.close(); }
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("P66_CLEANUP", { root, absent: true });
}, 300_000);
