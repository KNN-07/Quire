import { fileURLToPath } from "node:url";
import { endpoints, resultSchema } from "@quire/contracts";
import type { Page } from "@playwright/test";
import type { Id } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { authenticatedContext } from "../shared";

export const evidence = fileURLToPath(new URL("./evidence/", import.meta.url));
export const validSource = "\\documentclass{article}\n\\begin{document}\nKnown navigation text.\n\\newpage\nSecond page.\n\\end{document}";
export async function pdfBrowser(app: EditorApplication, browser: EditorBrowser, options: {
  readonly activeFile?: boolean; readonly width?: 1440 | 390;
} = {}) {
  const width = options.width ?? 1440;
  const actor = await authenticatedContext(browser, app, {
    viewport: { width, height: width === 390 ? 844 : 900 },
    isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
  });
  const errors: string[] = [];
  const httpCaptures: Promise<void>[] = [];
  try {
    const created = await actor.context.request.post("/api/projects", {
      headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { name: "PDF acceptance", origin: { kind: "blank" } },
    });
    const project = editorValue(resultSchema(endpoints.projectCreate.output).parse(await created.json()));
    const page = await actor.context.newPage();
    const mounted = Promise.withResolvers<void>();
    await page.exposeFunction("pdfHarnessMounted", () => mounted.resolve());
    await page.addInitScript(() => {
      document.addEventListener("pdf-harness-mounted", () => { void window.pdfHarnessMounted(); }, { once: true });
    });
    page.on("pageerror", error => {
      errors.push(error.message);
      console.info("PDF_BROWSER_PAGE_ERROR", error.message);
      mounted.reject(error);
    });
    page.on("console", message => {
      if (message.type() === "error" || message.type() === "warning") {
        errors.push(`${message.type()}: ${message.text()}`);
        console.info("PDF_BROWSER_CONSOLE", message.text());
      }
    });
    page.on("requestfailed", request => console.info("PDF_BROWSER_REQUEST_FAILED", request.url(), request.failure()));
    page.on("response", response => {
      if (response.status() >= 400) {
        errors.push(`HTTP ${response.status()} ${response.url()}`);
        httpCaptures.push(response.text().then(body => {
          console.info("PDF_BROWSER_HTTP_ERROR", response.status(), response.url(), body);
        }).catch(cause => {
          if (!(cause instanceof Error)) throw cause;
          console.info("PDF_BROWSER_HTTP_CAPTURE_FAILED", response.url(), cause.message);
        }));
      }
    });
    page.on("framenavigated", frame => {
      if (frame === page.mainFrame()) console.info("PDF_BROWSER_NAVIGATION", frame.url());
    });
    const url = new URL("/@fs" + fileURLToPath(new URL("./index.html", import.meta.url)), app.url);
    url.searchParams.set("project", project.id);
    url.searchParams.set("activeFile", String(options.activeFile ?? true));
    const deadline = setTimeout(() => mounted.reject(new Error("PDF harness did not emit its mounted event")), 30_000);
    try { await Promise.all([mounted.promise, page.goto(url.href, { waitUntil: "load" }).then(async response => {
      if (!response) throw new TypeError("PDF harness navigation had no HTTP response");
      await Bun.write(`${evidence}/startup-http-${project.id}.json`, JSON.stringify({
        status: response.status(), url: response.url(), headers: response.headers(), html: await response.text(),
      }, null, 2));
    })]); }
    finally { clearTimeout(deadline); }
    await page.evaluate(async () => {
      if (!Object.hasOwn(window, "pdfReady")) throw new TypeError("PDF harness readiness was lost to navigation");
      await window.pdfReady;
    });
    return { actor, page, project, errors, async [Symbol.asyncDispose]() {
      try {
        await page.screenshot({ path: `${evidence}/last-state-${project.id}.png` });
        await Bun.write(`${evidence}/last-state-${project.id}.json`, JSON.stringify({
          url: page.url(), html: await page.content(), errors,
        }, null, 2));
        console.info("PDF_BROWSER_LAST_STATE", { url: page.url(), host: await page.locator(".pdf-test-host").count() });
      }
      finally {
        try { await Promise.all(httpCaptures); await page.evaluate(() => window.pdfFixture?.dispose()); }
        finally { await actor[Symbol.asyncDispose](); }
      }
    } };
  } catch (error) {
    try {
      await Promise.all(httpCaptures);
      for (const page of actor.context.pages()) {
        await Bun.write(`${evidence}/startup-failure-${crypto.randomUUID()}.json`, JSON.stringify({
          url: page.url(), html: await page.content(), errors,
        }, null, 2));
      }
    } finally { await actor[Symbol.asyncDispose](); }
    throw error;
  }
}
/** Install before the action, then await pdfDomWait after it. No retrying assertion. */
export async function armDom(page: Page, selector: string) {
  await page.evaluate(expected => {
    window.pdfDomWait = new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error(`Missing DOM state ${expected}`)); }, 60_000);
      function check() {
        if (![...document.querySelectorAll(expected)].some(node => node instanceof HTMLOptionElement
          ? node.closest("select")?.checkVisibility() : node.checkVisibility())) return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      }
      observer.observe(document.body, { subtree: true, attributes: true, childList: true });
      check();
    });
  }, selector);
}
export async function rendered(page: Page) { await page.evaluate(() => window.pdfDomWait); }
export async function armCanvasRender(page: Page) {
  await page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")].find(node => node.checkVisibility());
    if (!canvas) throw new TypeError("PDF canvas missing");
    let started = canvas.dataset["rendered"] !== "true";
    window.pdfDomWait = new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (canvas.dataset["rendered"] === "false") started = true;
        if (!started || canvas.dataset["rendered"] !== "true") return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error("PDF transition did not render")); }, 30_000);
      observer.observe(canvas, { attributes: true });
    });
  });
}
export async function captureMatrix(page: Page, name: string) {
  const canvas = page.locator("canvas:visible");
  if (await canvas.count()) {
    await armDom(page, 'canvas[data-rendered="true"]');
    await rendered(page);
    const zoom = page.locator('select[aria-label="Zoom"]:visible');
    if (await zoom.inputValue() !== "fit") {
      await armCanvasRender(page);
      await zoom.selectOption("fit");
      await rendered(page);
    }
  }
  const viewport = page.viewportSize();
  if (!viewport) throw new TypeError("PDF verification requires a bounded viewport");
  const { width, height } = viewport;
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const body = page.locator(".q-pdf-body:visible").last();
    await body.evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png` });
    await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}-end.png` });
    const owners = await page.evaluate(() => [...document.querySelectorAll("*")]
      .filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight)
      .map(node => node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${node.className}`));
    const metrics = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, touch: navigator.maxTouchPoints }));
    if (metrics.width !== width || metrics.dpr !== (width === 390 ? 3 : 1)
      || (width === 390 && metrics.touch === 0)) throw new RangeError(`PDF viewport emulation did not apply: ${JSON.stringify(metrics)}`);
    await Bun.write(`${evidence}/${name}-${width}-${theme}-scroll.json`,
      JSON.stringify({ width, height, theme, metrics, owners }, null, 2));
    if (!(await page.locator(".q-pdf-panel").evaluate(node => node.scrollWidth <= node.clientWidth))) {
      throw new RangeError("PDF panel primary content overflows the viewport");
    }
  }
}
export async function edit(page: Page, text: string) { await page.evaluate(value => window.pdfFixture.edit(value), text); }
export async function discoverJob(page: Page, id: Id) {
  return page.evaluate(jobId => new Promise<ReturnType<typeof window.pdfFixture.controller.getSnapshot>>((resolve, reject) => {
    const controller = window.pdfFixture.controller;
    const unsubscribe = controller.subscribe(check);
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error(`Job discovery timed out: ${jobId}`)); }, 30_000);
    function check() {
      const state = controller.getSnapshot();
      if (state.job?.id !== jobId || state.job.status === "queued" || state.job.status === "running") return;
      unsubscribe(); clearTimeout(timeout); resolve(state);
    }
    check();
  }), id);
}
declare global { interface Window { pdfDomWait: Promise<void>; pdfHarnessMounted: () => Promise<void> } }
