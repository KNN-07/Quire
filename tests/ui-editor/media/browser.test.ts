import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, access as fsAccess } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser, openProjects, waitForRenderedText } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { createInputFile, createProject, responseAfter } from "../tools/helpers";
import type { mountMedia } from "./harness";

declare global { interface Window { mediaHarness: Awaited<ReturnType<typeof mountMedia>> } }
const evidence = process.env["QUIRE_MEDIA_EVIDENCE"]
  ?? fileURLToPath(new URL("../../../docs/evidence/p10-media/", import.meta.url));
const resources = new AsyncDisposableStack();
let app: EditorApplication;
let browser: EditorBrowser;
const initial = "\\documentclass{article}\n% exact  comment 😀\n\\begin{document}\nMedia proof\n\\end{document}\n";
beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  app = resources.use(await startEditorApplication());
  browser = resources.use(await startEditorBrowser());
  console.info("P10_MEDIA_OWNED", { runtime: Bun.version, root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin });
}, 120_000);
afterAll(async () => {
  await resources.disposeAsync();
  let removed = false;
  try { await fsAccess(app.dataDir); } catch { removed = true; }
  const closed = await Promise.all([app.url, app.apiUrl].map(async url => {
    try { await fetch(url, { signal: AbortSignal.timeout(2_000) }); return false; } catch { return true; }
  }));
  console.info("P10_MEDIA_CLOSED", { root: app.dataDir, removed, listenersClosed: closed, browserConnected: browser.browser.isConnected() });
}, 60_000);

test("native source and Visual clipboard, device/project/link routes, byte preservation and compile", async () => {
  await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
  await actor.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.url.origin });
  const project = await createProject(actor, { name: "P10 media proof", origin: app.url.origin });
  const page = await actor.context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openProjects(page);
  await page.evaluate(async id => {
    const path = "/@fs/home/norman/Repos/Quire/tests/ui-editor/media/harness.tsx";
    const harness: { mountMedia: typeof mountMedia } = await import(path);
    window.mediaHarness = await harness.mountMedia(id);
  }, project.id);
  try {
    await waitForRenderedText(page, "Insert figure");
    // Keep undo capture time fixed while real upload/network timers continue.
    await page.clock.setFixedTime(new Date("2026-10-27T12:00:00.000Z"));
    await page.evaluate(text => window.mediaHarness.reset(text), initial);
    const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    await source.waitFor({ state: "visible" });
    // Real system clipboard read by Chromium's keyboard paste, not a replaced paste handler.
    const pngBytes = await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 40;
      const drawing = canvas.getContext("2d");
      if (!drawing) throw new TypeError("Canvas unavailable");
      drawing.fillStyle = "#214a79"; drawing.fillRect(0, 0, 80, 40);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG failed")), "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      // Chromium sanitizes/re-encodes system PNGs before exposing them to paste.
      // Preserve the actual browser-delivered PNG, not inaccessible OS originals.
      const clipboard = await navigator.clipboard.read();
      const delivered = await clipboard[0]?.getType("image/png");
      if (!delivered) throw new Error("System clipboard PNG unavailable");
      return Array.from(new Uint8Array(await delivered.arrayBuffer()));
    });
    await page.getByRole("button", { name: "Select document end" }).click(); await source.focus();
    await page.keyboard.insertText("% preceding source edit\n");
    await page.evaluate(() => window.mediaHarness.flush());
    const beforeImage = await page.evaluate(() => window.mediaHarness.text());
    expect(beforeImage).toBe(initial.replace("\\end{document}", "% preceding source edit\n\\end{document}"));
    const pngResponse = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () => source.press("Control+V"));
    expect(pngResponse.status()).toBe(200);
    await waitForRenderedText(page, "Media proof");
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(check);
      const deadline = setTimeout(() => { observer.disconnect(); reject(new Error("Source image insertion not observed")); }, 30_000);
      function check() {
        if (!window.mediaHarness.text().includes("\\includegraphics")) return;
        observer.disconnect(); clearTimeout(deadline); resolve();
      }
      observer.observe(document.body, { childList: true, subtree: true, characterData: true }); check();
    }));
    await page.evaluate(() => window.mediaHarness.flush());
    const uploaded = editorValue(resultSchema(endpoints.filesUpload.output).parse(await pngResponse.json()))[0];
    if (!uploaded) throw new TypeError("PNG upload missing");
    const pngContent = await actor.context.request.get(`/api/projects/${project.id}/files/${uploaded.id}/content`, { params: { branch: "main" } });
    expect(Array.from(new Uint8Array(await pngContent.body()))).toEqual(pngBytes);
    await source.press("Control+Z");
    await page.evaluate(() => window.mediaHarness.flush());
    expect(await page.evaluate(() => window.mediaHarness.text())).toBe(beforeImage);
    await source.press("Control+Shift+Z");
    await page.evaluate(() => window.mediaHarness.flush());
    expect(await page.evaluate(() => window.mediaHarness.text())).toContain("\\usepackage{graphicx}");
    await page.getByRole("button", { name: "Show visual" }).click();
    await page.locator(".q-visual-figure img").waitFor({ state: "visible" });
    await page.locator(".q-visual-figure img").evaluate(async element => {
      if (!(element instanceof HTMLImageElement)) throw new Error("Preview image missing");
      await element.decode();
    });

    // Native ClipboardEvent file representation exposes JPEG/WebP/GIF/BMP in browsers
    // that deliver them. Chromium's system ClipboardItem write is PNG-only.
    for (const format of ["image/jpeg", "image/webp", "image/gif", "image/bmp"]) {
      await page.getByRole("button", { name: "Select document end" }).click();
      const uploadSignal = page.waitForResponse(response => response.url().includes(`/api/projects/${project.id}/uploads`) && response.request().method() === "POST");
      await page.locator(".q-visual").evaluate(async (element, mime) => {
        let blob: Blob;
        if (mime === "image/gif") {
          blob = new Blob([Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), c => c.charCodeAt(0))], { type: mime });
        } else if (mime === "image/bmp") {
          const bytes = new Uint8Array(58); const view = new DataView(bytes.buffer);
          bytes[0] = 66; bytes[1] = 77; view.setUint32(2, 58, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
          view.setInt32(18, 1, true); view.setInt32(22, 1, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, 4, true);
          bytes[54] = 120; bytes[55] = 80; bytes[56] = 40; blob = new Blob([bytes], { type: mime });
        } else {
          const canvas = document.createElement("canvas"); canvas.width = 30; canvas.height = 20;
          const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas missing");
          context.fillStyle = "#326145"; context.fillRect(0, 0, 30, 20);
          blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Encode failed")), mime));
        }
        const data = new DataTransfer(); data.items.add(new File([blob], "clipboard", { type: mime }));
        element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }, format);
      const response = await uploadSignal;
      expect(response.status()).toBe(200);
      const converted = editorValue(resultSchema(endpoints.filesUpload.output).parse(await response.json()))[0];
      if (!converted) throw new TypeError("Conversion upload missing");
      expect(converted.mime).toBe("image/png");
      await page.evaluate(path => new Promise<void>((resolve, reject) => {
        const observer = new MutationObserver(check);
        const deadline = setTimeout(() => { observer.disconnect(); reject(new Error("Converted image insertion not observed")); }, 30_000);
        function check() { if (window.mediaHarness.text().includes(path)) { observer.disconnect(); clearTimeout(deadline); resolve(); } }
        observer.observe(document.body, { childList: true, subtree: true, characterData: true }); check();
      }), converted.path);
      await page.evaluate(() => window.mediaHarness.flush());
      console.info("P10_CLIPBOARD_CONVERTED", { format, path: converted.path, mime: converted.mime });
    }
    const beforeReject = await page.evaluate(() => window.mediaHarness.text());
    await page.locator(".q-visual").evaluate(element => {
      const data = new DataTransfer();
      data.items.add(new File(["not png"], "one.png", { type: "image/png" }));
      data.items.add(new File(["not png"], "two.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await waitForRenderedText(page, "Paste exactly one");
    expect(await page.evaluate(() => window.mediaHarness.text())).toBe(beforeReject);

    await page.getByRole("button", { name: "Select document end" }).click();
    await page.getByRole("combobox", { name: "Figure source", exact: true }).selectOption("device");
    await page.getByLabel("Figure file", { exact: true }).setInputFiles({ name: "original.png", mimeType: "image/png", buffer: Buffer.from(pngBytes) });
    await page.getByLabel("Caption (LaTeX)", { exact: true }).fill("Original device bytes");
    await page.getByLabel("Label", { exact: true }).fill("fig:device");
    const deviceResponse = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () => page.getByRole("button", { name: "Insert figure", exact: true }).click());
    await waitForRenderedText(page, "Figure inserted.");
    const device = editorValue(resultSchema(endpoints.filesUpload.output).parse(await deviceResponse.json()))[0];
    if (!device) throw new Error("Device image missing");
    const original = await actor.context.request.get(`/api/projects/${project.id}/files/${device.id}/content`, { params: { branch: "main" } });
    expect(Array.from(new Uint8Array(await original.body()))).toEqual(pngBytes);
    await page.evaluate(() => window.mediaHarness.flush());
    const stored = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId });
    expect(stored.text).toContain("% exact  comment 😀");
    expect(stored.text).toContain("\\includegraphics[width=0.8\\linewidth]{images/original.png}");
    // A saved generated image follows the same existing-project insertion route.
    await page.getByRole("combobox", { name: "Figure source", exact: true }).selectOption("project");
    await page.getByLabel("Project image", { exact: true }).selectOption(device.path);
    await page.getByRole("button", { name: "Select document end" }).click();
    await page.getByRole("button", { name: "Insert figure", exact: true }).click();
    await waitForRenderedText(page, "Figure inserted.");
    await page.evaluate(() => window.mediaHarness.flush());
    expect((await page.evaluate(() => window.mediaHarness.text())).match(/images\/original.png/g)?.length).toBe(2);

    const sourceProject = await createProject(actor, { name: "P10 linked source", origin: app.url.origin });
    const sourceAccessResponse = await actor.context.request.get(`/api/projects/${sourceProject.id}/effective-access`, { params: { branch: "main" } });
    const sourceAccess = editorValue(resultSchema(endpoints.projectAccess.output).parse(await sourceAccessResponse.json()));
    const linkedUpload = await actor.context.request.post(`/api/projects/${sourceProject.id}/uploads`, {
      headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      multipart: { scope: JSON.stringify({ projectId: sourceProject.id, branch: "main" }), paths: JSON.stringify(["linked-source.png"]),
        expectedVersion: String(sourceAccess.branchRevision), files: { name: "linked-source.png", mimeType: "image/png", buffer: Buffer.from(pngBytes) } },
    });
    const linkedSource = editorValue(resultSchema(endpoints.filesUpload.output).parse(await linkedUpload.json()))[0];
    if (!linkedSource) throw new Error("Linked image upload missing");
    await page.getByRole("combobox", { name: "Figure source", exact: true }).selectOption("other");
    await page.getByLabel("Image source project ID").fill(sourceProject.id);
    await page.getByLabel("Image source file ID").fill(linkedSource.id);
    await page.getByLabel("Image project path").fill("images/from-project.png");
    await page.getByRole("button", { name: "Select document end" }).click();
    const projectLinkResponse = await responseAfter(page, { path: `/api/projects/${project.id}/links`, method: "POST" },
      () => page.getByRole("button", { name: "Insert figure", exact: true }).click());
    expect(projectLinkResponse.status()).toBe(200);
    const projectLink = editorValue(resultSchema(endpoints.linkCreate.output).parse(await projectLinkResponse.json()));
    expect(projectLink.link?.kind).toBe("project");
    await waitForRenderedText(page, "Figure inserted.");

    await page.getByRole("combobox", { name: "Figure source", exact: true }).selectOption("url");
    await page.getByLabel("Direct image URL").fill("https://www.w3.org/Icons/w3c_home.png");
    await page.getByLabel("Image project path").fill("images/from-url.png");
    await page.getByRole("button", { name: "Select document end" }).click();
    const urlResponse = await responseAfter(page, { path: `/api/projects/${project.id}/links`, method: "POST" },
      () => page.getByRole("button", { name: "Insert figure", exact: true }).click());
    expect(urlResponse.status()).toBe(200);
    const urlLink = editorValue(resultSchema(endpoints.linkCreate.output).parse(await urlResponse.json()));
    expect(urlLink.link?.kind).toBe("url");
    expect(urlLink.mime).toBe("image/png");
    await waitForRenderedText(page, "Figure inserted.");
    await page.evaluate(() => window.mediaHarness.flush());
    expect(await page.evaluate(() => window.mediaHarness.text())).toContain("{images/from-url.png}");
    expect(await page.evaluate(() => window.mediaHarness.text())).not.toContain("\\includegraphics{https:");
    console.info("P10_REAL_LINKS", { project: projectLink.path, url: urlLink.path, urlBytes: urlLink.bytes });

    // The real server must deny private URL targets without inserting source.
    const beforePrivate = await page.evaluate(() => window.mediaHarness.text());
    await page.getByLabel("Direct image URL").fill("https://127.0.0.1/private.png");
    await page.getByLabel("Image project path").fill("images/private.png");
    const privateResponse = await responseAfter(page, { path: `/api/projects/${project.id}/links`, method: "POST" },
      () => page.getByRole("button", { name: "Insert figure", exact: true }).click());
    expect(privateResponse.status()).toBe(403);
    expect(await page.evaluate(() => window.mediaHarness.text())).toBe(beforePrivate);
    console.info("P10_PRIVATE_URL_DENIED", { status: privateResponse.status(), body: await privateResponse.json() });

    async function compile() {
      await page.evaluate(() => window.mediaHarness.flush());
      const accessResponse = await actor.context.request.get(`/api/projects/${project.id}/effective-access`, { params: { branch: "main" } });
      const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await accessResponse.json()));
      using completion = nextApplicationEvent(app, event => event.topic === "job.changed" &&
        event.aggregateId === project.id && (event.payload.status === "succeeded" || event.payload.status === "failed"), 90_000);
      const queued = await actor.context.request.post(`/api/projects/${project.id}/compiles`, {
        headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
        data: { scope: { projectId: project.id, branch: "main" }, expectedRevision: access.branchRevision, settings: project.settings, clean: true },
      });
      expect(queued.status()).toBe(202);
      const event = await completion.promise;
      if (event.topic !== "job.changed") throw new Error("Compile event missing");
      const response = await actor.context.request.get(`/api/compiles/${event.payload.resourceId}`);
      const job = editorValue(resultSchema(endpoints.compileGet.output).parse(await response.json()));
      console.info("P10_REAL_COMPILE", { id: job.id, status: job.status, diagnostics: job.diagnostics });
      expect(job.status).toBe("succeeded");
      const pdf = job.artifacts.find(artifact => artifact.kind === "pdf");
      if (!pdf) throw new Error("Real PDF missing");
      const result = await actor.context.request.get(`/api/artifacts/${pdf.id}/content`);
      const bytes = await result.body();
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      return bytes;
    }
    const compiledPdf = await compile();
    await page.getByRole("combobox", { name: "Figure source", exact: true }).selectOption("device");
    await page.getByLabel("Figure file", { exact: true }).setInputFiles({ name: "compiled.pdf", mimeType: "application/pdf", buffer: compiledPdf });
    await page.getByRole("button", { name: "Select document end" }).click();
    await page.getByRole("button", { name: "Insert figure", exact: true }).click();
    await waitForRenderedText(page, "Figure inserted.");
    const jpeg = await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 12;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas missing");
      context.fillStyle = "#214a79"; context.fillRect(0, 0, 16, 12);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("JPEG failed")), "image/jpeg"));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.getByLabel("Figure file", { exact: true }).setInputFiles({ name: "original.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg) });
    await page.getByRole("button", { name: "Select document end" }).click();
    const jpegResponse = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" },
      () => page.getByRole("button", { name: "Insert figure", exact: true }).click());
    const jpegFile = editorValue(resultSchema(endpoints.filesUpload.output).parse(await jpegResponse.json()))[0];
    if (!jpegFile) throw new Error("JPEG missing");
    await waitForRenderedText(page, "Figure inserted.");
    const originalJpeg = await actor.context.request.get(`/api/projects/${project.id}/files/${jpegFile.id}/content`, { params: { branch: "main" } });
    expect(Array.from(new Uint8Array(await originalJpeg.body()))).toEqual(jpeg);
    await compile();

    await page.getByRole("button", { name: "Show source" }).click();
    await page.getByRole("button", { name: "Select all source" }).click();
    await source.focus(); await source.press("Control+C");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.evaluate(() => window.mediaHarness.text()));
    await page.getByRole("button", { name: "Show visual" }).click();

    for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
      await page.getByRole("combobox", { name: "Figure source", exact: true }).selectOption("device");
      await page.locator(".q-figure-panel").screenshot({ path: `${evidence}figure-${width}-${theme}.png` });
      await page.locator(".q-visual-body").evaluate(element => { element.scrollTop = 0; });
      await page.locator(".q-visual").screenshot({ path: `${evidence}visual-${width}-${theme}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => window.mediaHarness.dispose());
    await page.close();
  }
}, 180_000);

test("Source JPEG paste converts to PNG and stale completion cannot replace a later source edit", async () => {
  await using actor = await authenticatedContext(browser, app);
  const project = await createProject(actor, { name: "P10 source clipboard fences", origin: app.url.origin });
  const page = await actor.context.newPage();
  await openProjects(page);
  await page.evaluate(async id => {
    const path = "/@fs/home/norman/Repos/Quire/tests/ui-editor/media/harness.tsx";
    const harness: { mountMedia: typeof mountMedia } = await import(path);
    window.mediaHarness = await harness.mountMedia(id);
  }, project.id);
  const release = Promise.withResolvers<void>();
  try {
    await waitForRenderedText(page, "Insert figure");
    await page.evaluate(text => window.mediaHarness.reset(text), initial);
    const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    await source.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Select document end" }).click();
    const pasteJpeg = () => source.evaluate(async element => {
      const canvas = document.createElement("canvas"); canvas.width = 240; canvas.height = 120;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas missing");
      context.fillStyle = "#326145"; context.fillRect(0, 0, 240, 120);
      context.fillStyle = "#ffffff"; context.font = "18px sans-serif";
      context.fillText("Source JPEG to PNG", 24, 65);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("JPEG missing")), "image/jpeg"));
      const data = new DataTransfer(); data.items.add(new File([blob], "paste.jpg", { type: "image/jpeg" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const jpegResponse = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, pasteJpeg);
    expect(jpegResponse.status()).toBe(200);
    const jpeg = editorValue(resultSchema(endpoints.filesUpload.output).parse(await jpegResponse.json()))[0];
    expect(jpeg?.mime).toBe("image/png");
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(check);
      const deadline = setTimeout(() => { observer.disconnect(); reject(new Error("Source JPEG insertion missing")); }, 30_000);
      function check() {
        if (window.mediaHarness.text().includes("\\includegraphics")) { observer.disconnect(); clearTimeout(deadline); resolve(); }
      }
      observer.observe(document.body, { childList: true, subtree: true, characterData: true }); check();
    }));
    await page.evaluate(() => window.mediaHarness.flush());
    const before = await page.evaluate(() => window.mediaHarness.text());
    await page.getByRole("button", { name: "Show visual" }).click();
    await page.locator(".q-visual-figure img").waitFor({ state: "visible" });
    await page.locator(".q-visual-figure img").evaluate(async element => {
      if (!(element instanceof HTMLImageElement)) throw new Error("Preview image missing");
      await element.decode();
    });
    await page.getByRole("combobox", { name: "Figure source", exact: true }).selectOption("device");
    for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
      await page.locator(".q-figure-panel").screenshot({ path: `${evidence}figure-${width}-${theme}.png` });
      await page.locator(".q-visual-body").evaluate(element => { element.scrollTop = 0; });
      const preview = await page.locator(".q-visual-figure img").evaluate(async element => {
        if (!(element instanceof HTMLImageElement)) throw new Error("Preview missing");
        await element.decode();
        const canvas = document.createElement("canvas"); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
        const context = canvas.getContext("2d"); if (!context) throw new Error("Preview canvas missing");
        context.drawImage(element, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let white = 0;
        for (let at = 0; at < pixels.length; at += 4) if ((pixels[at] ?? 0) > 200 && (pixels[at + 1] ?? 0) > 200 && (pixels[at + 2] ?? 0) > 200) white++;
        return { width: canvas.width, height: canvas.height, white, colorScheme: getComputedStyle(element).colorScheme };
      });
      expect(preview.white).toBeGreaterThan(100);
      console.info("P10_PREVIEW_DECODED", { viewportWidth: width, theme, ...preview });
      await page.locator(".q-visual").screenshot({ path: `${evidence}visual-${width}-${theme}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
    await page.getByRole("button", { name: "Show source" }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await source.evaluate(element => {
      const data = new DataTransfer(); data.items.add(new File(["<svg/>"], "paste.svg", { type: "image/svg+xml" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await waitForRenderedText(page, "SVG and multiple files are not supported");
    expect(await page.evaluate(() => window.mediaHarness.text())).toBe(before);

    // Hold an unchanged, real successful upload response. The server has already
    // committed the asset when the user changes source; no authority is mocked.
    const fetched = Promise.withResolvers<void>();
    await page.route(`**/api/projects/${project.id}/uploads`, async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      fetched.resolve();
      await release.promise;
      await route.fulfill({ response });
    }, { times: 1 });
    await page.getByRole("button", { name: "Select document end" }).click();
    await pasteJpeg();
    await fetched.promise;
    const changed = before + "% exact concurrent edit 😀\n";
    await page.evaluate(text => window.mediaHarness.reset(text), changed);
    release.resolve();
    await waitForRenderedText(page, "Source changed during upload");
    expect(await page.evaluate(() => window.mediaHarness.text())).toBe(changed);
    const saved = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId });
    expect(saved.text).toBe(changed);
    console.info("P10_SOURCE_STALE_UPLOAD_PRESERVED", { firstImage: jpeg?.path, exactTextPreserved: true });

    const secondText = "A separate source file.\n";
    const second = await createInputFile(actor, { projectId: project.id, origin: app.url.origin, path: "second.tex", text: secondText });
    // Refresh the real workspace before navigation to the new file.
    await page.evaluate(() => window.mediaHarness.dispose());
    await openProjects(page);
    await page.evaluate(async id => {
      const path = "/@fs/home/norman/Repos/Quire/tests/ui-editor/media/harness.tsx";
      const harness: { mountMedia: typeof mountMedia } = await import(path);
      window.mediaHarness = await harness.mountMedia(id);
    }, project.id);
    await waitForRenderedText(page, "Insert figure");
    await source.waitFor({ state: "visible" });
    const fileSwitchFetched = Promise.withResolvers<void>();
    const fileSwitchRelease = Promise.withResolvers<void>();
    await page.route(`**/api/projects/${project.id}/uploads`, async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      fileSwitchFetched.resolve();
      await fileSwitchRelease.promise;
      await route.fulfill({ response });
    }, { times: 1 });
    try {
      await page.getByRole("button", { name: "Select document end" }).click();
      await pasteJpeg();
      await fileSwitchFetched.promise;
      await page.evaluate(id => window.mediaHarness.openFile(id), second.id);
      await page.getByRole("textbox", { name: "Source: second.tex", exact: true }).waitFor({ state: "visible" });
      fileSwitchRelease.resolve();
      await page.unrouteAll({ behavior: "wait" });
      expect(await page.evaluate(() => window.mediaHarness.text())).toBe(secondText);
      const originalMain = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId });
      expect(originalMain.text).toBe(changed);
      console.info("P10_SOURCE_FILE_SWITCH_CANCELED", { old: project.settings.mainFileId, current: second.id, oldAndNewPreserved: true });
    } finally { fileSwitchRelease.resolve(); }
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
    await page.evaluate(() => window.mediaHarness.dispose());
    await page.close();
  }
}, 90_000);
