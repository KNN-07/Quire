import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BrowserContextOptions } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import {
  authenticateApi,
  nextApplicationEvent,
  startEditorApplication,
  startEditorBrowser,
} from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

const evidence = process.env["QUIRE_EDITOR_VISUAL_EVIDENCE"]
  ?? fileURLToPath(new URL("../../../docs/evidence/p2u/visual-current/", import.meta.url));
const projectPath = `/projects/${fixtureIds.project}`;
const routes = [
  { page: "edit", selector: '.qe-main .cm-content[contenteditable="true"]' },
  { page: "git", selector: ".qe-route .git-workspace" },
  { page: "agent", selector: ".qe-route .qa-assistant textarea" },
  { page: "history", selector: ".qe-route .quire-history" },
  { page: "review", selector: ".qe-secondary .quire-review__review-grid" },
  { page: "logs", selector: ".q-pdf-log" },
  { page: "pdf-diff", selector: '.q-pdf-panel select[aria-label="From revision"]' },
] as const;

describe("independent current-source editor visual matrix", () => {
  const resources = new AsyncDisposableStack();
  const observations: unknown[] = [];
  let app: EditorApplication;
  let browser: EditorBrowser;
  let owner: Awaited<ReturnType<typeof authenticateApi>>;

  beforeAll(async () => {
    await mkdir(evidence, { recursive: true });
    app = await startEditorApplication();
    resources.defer(() => app[Symbol.asyncDispose]());
    browser = await startEditorBrowser();
    resources.defer(() => browser[Symbol.asyncDispose]());
    owner = await authenticateApi(app);
    console.info("P2U_VISUAL_ACCEPTANCE_OWNED", {
      runtime: Bun.version, web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir, evidence,
    });
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      await context.addCookies([owner.cookie]);
      const accessResponse = await context.request.get(`/api/projects/${fixtureIds.project}/effective-access`, {
        params: { branch: "main" },
      });
      const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await accessResponse.json()));
      const projectResponse = await context.request.get(`/api/projects/${fixtureIds.project}`, {
        params: { branch: "main" },
      });
      const project = editorValue(resultSchema(endpoints.projectGet.output).parse(await projectResponse.json()));
      using complete = nextApplicationEvent(app, event => event.topic === "job.changed"
        && event.aggregateId === fixtureIds.project && event.payload.status === "succeeded", 90_000);
      const [queued, completed] = await Promise.all([
        context.request.post(endpoints.compileCreate.path.replace(":p", fixtureIds.project), {
          headers: {
            origin: app.url.origin,
            "x-csrf-token": owner.session.csrfToken,
            "idempotency-key": crypto.randomUUID(),
          },
          data: {
            scope: { projectId: fixtureIds.project, branch: "main" },
            expectedRevision: access.branchRevision,
            settings: project.settings,
            clean: false,
          },
        }),
        complete.promise,
      ]);
      expect(queued.status()).toBe(202);
      if (completed.topic !== "job.changed") throw new Error("Actual completed compile event required");
      const jobResponse = await context.request.get(
        endpoints.compileGet.path.replace(":id", completed.payload.resourceId));
      const jobEnvelope: unknown = await jobResponse.json();
      const job = editorValue(resultSchema(endpoints.compileGet.output).parse(jobEnvelope));
      expect(job.status).toBe("succeeded");
      const artifact = job.artifacts.find(value => value.kind === "pdf" && value.name === "output.pdf");
      if (!artifact) throw new Error("Actual compiled PDF artifact required");
      const download = await context.request.get(endpoints.artifactContent.path.replace(":id", artifact.id));
      expect(download.status()).toBe(200);
      const bytes = await download.body();
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.byteLength).toBe(artifact.bytes);
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
      await Bun.write(`${evidence}/native-preview.pdf`, bytes);
      await Bun.write(`${evidence}/compile-http.json`, JSON.stringify({
        queued: { status: queued.status(), body: await queued.json() },
        completed: { status: jobResponse.status(), body: jobEnvelope },
        artifact: { status: download.status(), contentType: download.headers()["content-type"], ...artifact },
      }, null, 2));
    } finally { await context.close(); }
  }, 120_000);

  afterAll(async () => {
    await Bun.write(`${evidence}/manifest.json`, JSON.stringify(observations, null, 2));
    await resources.disposeAsync();
    console.info("P2U_VISUAL_ACCEPTANCE_CLOSED", {
      web: app?.url.origin, api: app?.apiUrl.origin, root: app?.dataDir,
    });
  }, 90_000);

  for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
    for (const route of routes) {
      test(`${route.page} ${width} ${theme}`, async () => {
        const options: BrowserContextOptions = {
          baseURL: app.url.origin,
          viewport: { width, height: width === 390 ? 844 : 900 },
          colorScheme: theme,
          ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
        };
        const context = await browser.browser.newContext(options);
        try {
          await context.addCookies([owner.cookie]);
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", cause => errors.push(cause.message));
          page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
          await openSurface(page, { path: `${projectPath}/${route.page}`, selector: route.selector });
          const saved = await surfaceSignal(page, '.qe-status [data-save-state="saved"]');
          await saved.observed;
          const environment = await surfaceSignal(page, '.qe-status [data-environment-state="ready"]');
          await environment.observed;
          if (route.page === "history") {
            const comparisonReady = await surfaceSignal(page, ".quire-history:not(:has(.quire-review__loading))");
            await comparisonReady.observed;
          }
          if (route.page === "edit" && width !== 390) {
            const rendered = await surfaceSignal(page, 'canvas[data-rendered="true"]', 120_000);
            await rendered.observed;
          }
          const geometry = await page.evaluate(selector => {
            const principal = document.querySelector(selector)?.getBoundingClientRect();
            return {
              principal: principal ? {
                x: principal.x, y: principal.y, width: principal.width, height: principal.height,
              } : null,
              viewport: { width: innerWidth, height: innerHeight },
              document: {
                width: document.documentElement.scrollWidth,
                height: document.documentElement.scrollHeight,
              },
              overflowX: document.documentElement.scrollWidth > innerWidth,
              overflowY: document.documentElement.scrollHeight > innerHeight,
            };
          }, route.selector);
          const base = `${route.page}-${width}-${theme}`;
          await page.screenshot({ path: `${evidence}/${base}.png` });
          const scrollOwners = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("*")]
            .filter(node => node.getClientRects().length
              && /auto|scroll/.test(getComputedStyle(node).overflowY)
              && node.scrollHeight > node.clientHeight)
            .map(node => {
              const identity = node.id ? `#${node.id}` :
                `${node.tagName.toLowerCase()}.${node.className.trim().split(/\s+/).join(".")}`;
              node.scrollTop = node.scrollHeight;
              return identity;
            }));
          await page.screenshot({ path: `${evidence}/${base}-end.png` });
          if (route.page === "logs") {
            const rawLog = await page.getByRole("button", { name: "Raw log", exact: true }).boundingBox();
            if (!rawLog) throw new Error("Missing raw log control");
            expect(rawLog.x + rawLog.width).toBeLessThanOrEqual(width);
          }
          if (route.page === "pdf-diff") {
            for (const name of ["From revision", "To revision", "Comparison mode"]) {
              const box = await page.getByRole("combobox", { name, exact: true }).boundingBox();
              if (!box) throw new Error(`Missing comparison control: ${name}`);
              expect(box.x).toBeGreaterThanOrEqual(0);
              expect(box.x + box.width).toBeLessThanOrEqual(width);
            }
            const compare = await page.getByRole("button", { name: "Compare PDFs", exact: true }).boundingBox();
            if (!compare) throw new Error("Missing comparison action");
            expect(compare.x + compare.width).toBeLessThanOrEqual(width);
          }
          if (route.page === "edit") {
            if (width === 390) {
              await page.locator(".qe-mobile-tabs").getByRole("button", { name: "PDF", exact: true }).click();
              const rendered = await surfaceSignal(page, '.qe-secondary:not([hidden]) canvas[data-rendered="true"]', 120_000);
              await rendered.observed;
              await page.screenshot({ path: `${evidence}/${base}-pdf.png` });
            }
            const optionsSummary = page.locator("summary", { hasText: "PDF options" });
            await optionsSummary.click();
            await page.screenshot({ path: `${evidence}/${base}-pdf-options.png` });
            const optionsFit = async () => {
              const bounds = await page.locator(".q-pdf-options>.q-pdf-toolbar").evaluate(node => ({
                width: node.clientWidth, scrollWidth: node.scrollWidth,
                left: node.getBoundingClientRect().left,
                right: node.getBoundingClientRect().right,
                bottom: node.getBoundingClientRect().bottom,
                panelLeft: node.closest(".q-pdf-panel")?.getBoundingClientRect().left ?? 0,
                panelRight: node.closest(".q-pdf-panel")?.getBoundingClientRect().right ?? 0,
                panelBottom: node.closest(".q-pdf-panel")?.getBoundingClientRect().bottom ?? 0,
              }));
              expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
              expect(bounds.left).toBeGreaterThanOrEqual(bounds.panelLeft);
              expect(bounds.right).toBeLessThanOrEqual(bounds.panelRight);
              expect(bounds.bottom).toBeLessThanOrEqual(bounds.panelBottom);
            };
            await optionsFit();
            await page.keyboard.press("Escape");
            if (width === 390) {
              const drawer = await surfaceSignal(page, "dialog[open]");
              await page.locator(".qe-mobile-tabs").getByRole("button", { name: "Files", exact: true }).click();
              await drawer.observed;
              await page.screenshot({ path: `${evidence}/${base}-files.png` });
              await page.getByText("File actions", { exact: true }).click();
              await page.screenshot({ path: `${evidence}/${base}-file-actions.png` });
              await page.keyboard.press("Escape");
              await page.keyboard.press("Escape");
            } else {
              await page.getByRole("button", { name: "Vertical", exact: true }).click();
              const stacked = await surfaceSignal(page, '.qe-panes[data-layout="stacked"]');
              await stacked.observed;
              await optionsSummary.click();
              await page.screenshot({ path: `${evidence}/${base}-stacked-options.png` });
              await optionsFit();
            }
          }
          observations.push({ route: route.page, width, theme, geometry, scrollOwners, errors });
          expect(geometry.principal?.width ?? 0).toBeGreaterThan(0);
          expect(geometry.principal?.height ?? 0).toBeGreaterThan(0);
          expect(geometry.overflowX).toBe(false);
          expect(geometry.overflowY).toBe(false);
          expect(errors).toEqual([]);
        } finally { await context.close(); }
      }, 150_000);
    }
  }
});
