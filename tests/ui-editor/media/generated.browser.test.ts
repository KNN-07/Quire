import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../shared";
import { createInputFile, createProject, responseAfter } from "../tools/helpers";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

const program = String.raw`import struct
import zlib
from pathlib import Path
width, height = 32, 24
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
rows = b"".join(b"\0" + bytes(channel for x in range(width) for channel in (x * 8, y * 10, (x + y) * 4)) for y in range(height))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
Path("/outputs/generated-proof.png").write_bytes(png)
print("GENERATED_PNG", width, height)
`;

test("inserts and compiles actual reviewed Python-generated output in the mounted editor", async () => {
  const roots: string[] = [];
  const evidence = `docs/evidence/p10-media/generated-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  {
    await using app = await startEditorApplication();
    roots.push(app.dataDir);
    console.info("GENERATED_FIGURE_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
    const project = await createProject(owner, { name: "Actual generated figure", origin: app.url.origin });
    const script = await createInputFile(owner, {
      projectId: project.id, origin: app.url.origin, path: "generate_figure.py", text: program,
    });
    const page = await owner.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openSurface(page, { path: `/projects/${project.id}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
    const ready = await surfaceSignal(page, '.qe-status [data-save-state="saved"]');
    await ready.observed;
    const initial = "\\documentclass{article}\n\\begin{document}\nGenerated plot proof\n\\end{document}\n";
    const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    {
      using saved = nextApplicationEvent(app, event => event.topic === "document.saved" && event.aggregateId === project.id);
      await source.press("ControlOrMeta+A");
      await Promise.all([saved.promise, page.keyboard.insertText(initial)]);
    }
    expect((await projectDocument(owner.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId })).text).toBe(initial);
    console.info("GENERATED_FIGURE_SOURCE_SAVED");
    const scope = { projectId: project.id, branch: "main" };
    await page.getByLabel("Editor tool", { exact: true }).selectOption("python");
    await page.getByLabel("Installed runtime directory", { exact: true }).fill(new URL(process.env["QUIRE_TEST_PYODIDE_URL"] ?? "/extensions/pyodide/", app.url).href);
    await page.getByLabel("Pinned Pyodide version", { exact: true }).fill(process.env["QUIRE_TEST_PYODIDE_VERSION"] ?? "314.0.7");
    await page.getByLabel("Enable browser Python on this browser", { exact: true }).check();
    await page.getByRole("button", { name: "Save installation configuration", exact: true }).click();
    await waitForRenderedText(page, "Browser installation configuration saved.");
    await page.getByLabel("Project Python script", { exact: true }).selectOption(script.id);
    await page.getByRole("button", { name: "Run selected Python", exact: true }).click();
    await waitForRenderedText(page, "Generated file review");
    await page.getByLabel("Project path for generated-proof.png", { exact: true }).fill("figures/generated-proof.png");
    await page.getByRole("checkbox", { name: /^Approve generated-proof\.png/ }).check();
    await page.screenshot({ path: `${evidence}/reviewed-runtime-output.png` });
    const uploaded = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" },
      () => page.getByRole("button", { name: "Save approved files", exact: true }).click());
    const files = editorValue(resultSchema(endpoints.filesUpload.output).parse(await uploaded.json()));
    const image = files.find(file => file.path === "figures/generated-proof.png");
    if (!image) throw new Error("Actual approved runtime output was not saved");
    const imageResponse = await owner.context.request.get(`/api/projects/${project.id}/files/${image.id}/content`, {
      params: { branch: "main" },
    });
    const bytes = await imageResponse.body();
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(32);
    expect(bytes.readUInt32BE(20)).toBe(24);
    await Bun.write(`${evidence}/generated-proof.png`, bytes);
    await waitForRenderedText(page, "Approved generated files saved to the project.");
    await page.getByLabel("Editor tool", { exact: true }).selectOption("figure");
    await page.getByLabel("Figure source", { exact: true }).selectOption("project");
    await page.getByLabel("Project image", { exact: true }).selectOption(image.path);
    await page.getByLabel("Caption (LaTeX)", { exact: true }).fill("Generated grid");
    await page.getByLabel("Label", { exact: true }).fill("fig:generated-proof");
    await page.getByLabel("Width (fraction of line)", { exact: true }).fill("0.4");
    await source.focus();
    await source.press("ControlOrMeta+End");
    await source.press("ArrowUp");
    await source.press("Home");
    await page.getByRole("button", { name: "Insert figure", exact: true }).click();
    await waitForRenderedText(page, "Figure inserted.");
    using completed = nextApplicationEvent(app, event => event.topic === "job.changed"
      && event.aggregateId === project.id && event.payload.status === "succeeded", 90_000);
    const submitted = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === endpoints.compileCreate.path.replace(":p", project.id));
    {
      const [queued] = await Promise.all([
        submitted, completed.promise, page.getByRole("button", { name: "Recompile", exact: true }).first().click(),
      ]);
      const job = editorValue(resultSchema(endpoints.compileCreate.output).parse(await queued.json()));
      const terminal = await owner.context.request.get(endpoints.compileGet.path.replace(":id", job.id));
      const result = editorValue(resultSchema(endpoints.compileGet.output).parse(await terminal.json()));
      expect(result.status).toBe("succeeded");
      const pdf = result.artifacts.find(artifact => artifact.kind === "pdf");
      if (!pdf) throw new Error("Generated-figure compile did not produce a PDF");
      const download = await owner.context.request.get(`/api/artifacts/${pdf.id}/content`);
      await Bun.write(`${evidence}/generated-figure.pdf`, await download.body());
      await Bun.write(`${evidence}/compile-response.json`, JSON.stringify(result, null, 2));
    }
    const saved = await projectDocument(owner.context, { ...scope, fileId: project.settings.mainFileId });
    expect(saved.text).toContain("\\usepackage{graphicx}");
    expect(saved.text).toContain("figures/generated-proof.png");
    expect(saved.text).toContain("\\caption{Generated grid}");
    expect(saved.text).toContain("\\label{fig:generated-proof}");
    expect(saved.text).toContain("width=0.4\\linewidth");
    expect(saved.text.indexOf("\\includegraphics")).toBeLessThan(saved.text.indexOf("\\end{document}"));
    await Bun.write(`${evidence}/generated-figure.tex`, saved.text);
    const rendered = await surfaceSignal(page, 'canvas[data-rendered="true"]', 90_000);
    await rendered.observed;
    await page.screenshot({ path: `${evidence}/compiled-generated-figure.png` });
    await page.reload({ waitUntil: "domcontentloaded" });
    const reopened = await surfaceSignal(page, '.qe-status [data-save-state="saved"]');
    await reopened.observed;
    expect((await projectDocument(owner.context, { ...scope, fileId: project.settings.mainFileId })).text).toBe(saved.text);
    expect(errors).toEqual([]);
  }
  for (const root of roots) await rejects(stat(root), { code: "ENOENT" });
  console.info("GENERATED_FIGURE_CLOSED", { roots, evidence });
}, 240_000);
