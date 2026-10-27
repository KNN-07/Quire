// Run from repository root with native Bun 1.3.14.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { createFixture } from "./protocol-fixture.mjs";
import { checkBehavior, waitDom } from "./browser-checks.mjs";
const browserLibrary = process.env["QUIRE_BROWSER_LIBRARY"] ?? "/home/norman/.omo/binary-runtime/5.1.48/plugin/skills/browser/scripts/omowright.mjs";
const { loadOmowright } = await import(browserLibrary);

const evidence = resolve("docs/evidence/p1-ui-projects");
const temporary = await mkdtemp("/tmp/quire-projects-");
process.env.TMPDIR = temporary;
process.env.XDG_CACHE_HOME = join(temporary, "cache");
await mkdir(evidence, { recursive: true });
const report = { source: "Actual React with real typed client and schema-validated HTTP fixtures; backend integration pending.", cases: [], cleanup: {} };
let browser;
let server;
let fixture = createFixture();
try {
  const build = await Bun.build({ entrypoints: [resolve("tests/ui-product/projects/preview.tsx")], outdir: join(temporary, "build"), target: "browser", minify: true });
  assert.equal(build.success, true, JSON.stringify(build.logs));
  const zipPath = join(temporary, "project.zip");
  await Bun.write(zipPath, zipSync({ "main.tex": strToU8("\\documentclass{article}\\begin{document}Hello\\end{document}") }));
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/api/")) return fixture.handle(request);
      if (path === "/") return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quire projects verification</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>', { headers: { "content-type": "text/html" } });
      return new Response(Bun.file(join(temporary, "build", path.slice(1))));
    },
  });
  const { omowright } = await loadOmowright();
  browser = await omowright.connectPipe({
    browserPath: "/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
    browserArgs: ["--headless", "--no-sandbox", "--user-data-dir=" + join(temporary, "profile")], storageRoot: join(temporary, "profile"),
  });
  // Given: the actual onboarding import destination rather than a dashboard button.
  const importPage = await browser.newTab("about:blank");
  await omowright.emulate(importPage, "desktop-1440");
  // When: the project page receives the onboarding query.
  await importPage.goto(new URL("?new=import", server.url).href, { waitUntil: "load" });
  await importPage.getByRole("dialog").waitFor({ state: "visible" });
  // Then: ZIP import is selected, and closing consumes the one-shot navigation query.
  assert.equal(await importPage.getByRole("tab", { name: "Upload .zip", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await importPage.locator('input[type="file"]').count(), 1);
  await Bun.write(join(evidence, "onboarding-import.png"), await importPage.screenshot());
  await importPage.keyboard.press("Escape");
  await importPage.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await importPage.locator("output").textContent(), "/projects");
  await importPage.close();
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    fixture = createFixture();
    const page = await browser.newTab("about:blank");
    await page.goto(server.url.href, { waitUntil: "commit" });
    await omowright.emulate(page, width === 390 ? "iphone-14" : "desktop-1440");
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.getByRole("button", { name: "Latent Dynamics Note", exact: true }).waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    await Bun.write(join(evidence, `dashboard-${width}-${theme}.png`), await page.screenshot({ fullPage: true }));
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await Bun.write(join(evidence, `end-${width}-${theme}.png`), await page.screenshot());
    await page.evaluate(() => window.scrollTo(0, 0));
    const geometry = await page.evaluate(() => ({
      width: innerWidth, dpr: devicePixelRatio, overflow: document.documentElement.scrollWidth > innerWidth,
      scrollOwners: [...document.querySelectorAll("*")].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight).map(el => el.className),
    }));
    assert.equal(geometry.overflow, false);
    if (width === 390) {
      await page.getByRole("button", { name: "Project filters", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
      await Bun.write(join(evidence, `drawer-${width}-${theme}.png`), await page.screenshot());
      await page.locator("dialog .p-nav button").filter({ hasText: "Archived" }).click();
      await waitDom(page, { text: "No projects found" });
      await page.getByRole("button", { name: "Project filters", exact: true }).click();
      await page.locator("dialog .p-nav button").filter({ hasText: "All projects" }).click();
      await page.getByRole("button", { name: "Latent Dynamics Note", exact: true }).waitFor({ state: "visible" });
    }
    await page.getByRole("button", { name: "Blank project", exact: true }).click();
    for (const mode of ["Blank", "From template", "Import from GitHub", "Upload .zip", "Clone git URL"]) {
      await page.getByRole("tab", { name: mode, exact: true }).click();
      await Bun.write(join(evidence, `dialog-${mode.replaceAll(/[^a-z]/gi, "-")}-${width}-${theme}.png`), await page.screenshot());
      const fits = await page.evaluate(() => {
        const dialog = document.querySelector("dialog"), box = dialog.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth;
      });
      assert.equal(fits, true, `${width} ${theme} ${mode}`);
      const footer = await page.evaluate(() => {
        const dialog = document.querySelector("dialog");
        dialog.scrollTop = dialog.scrollHeight;
        const box = dialog.querySelector(".q-modal__footer").getBoundingClientRect();
        return { reachable: box.top >= 0 && box.bottom <= innerHeight, backgroundLocked: document.body.style.overflow === "hidden" };
      });
      assert.equal(footer.reachable, true, `${width} ${theme} ${mode} footer`);
      assert.equal(footer.backgroundLocked, true);
      await Bun.write(join(evidence, `dialog-end-${mode.replaceAll(/[^a-z]/gi, "-")}-${width}-${theme}.png`), await page.screenshot());
      await page.evaluate(() => { document.querySelector("dialog").scrollTop = 0; });
    }
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    if (width === 1440 && theme === "light") report.behavior = await checkBehavior(page, fixture, zipPath);
    fixture.failNext("projectList", "OFFLINE", "API is unavailable.");
    await page.getByRole("button", { name: "Refresh projects", exact: true }).click();
    await waitDom(page, { text: "OFFLINE:" });
    await Bun.write(join(evidence, `error-${width}-${theme}.png`), await page.screenshot({ fullPage: true }));
    await page.getByRole("button", { name: "Retry projects", exact: true }).click();
    await page.getByRole("button", { name: "Latent Dynamics Note", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("textbox", { name: "Search projects and templates", exact: true }).fill("no-such-project");
    await waitDom(page, { text: "No projects found" });
    await Bun.write(join(evidence, `empty-${width}-${theme}.png`), await page.screenshot({ fullPage: true }));
    report.cases.push({ width, theme, geometry, fiveModesFit: true, fiveFootersReachable: true, backgroundLocked: true, errorRetryEmpty: true, requests: fixture.calls.length });
    await page.close();
    console.log(`PASS ${width} ${theme}`);
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  report.requests = fixture.calls;
  if (browser) { await browser.close(); report.cleanup.browserClosed = true; }
  if (server) { await server.stop(true); report.cleanup.serverStopped = true; }
  await rm(temporary, { recursive: true, force: true });
  report.cleanup.temporaryRoot = temporary;
  report.cleanup.removed = true;
  await Bun.write(join(evidence, "browser-results.json"), JSON.stringify(report, null, 2));
}
console.log("PROJECTS_VERIFIED");
