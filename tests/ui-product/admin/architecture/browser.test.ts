import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { endpoints, resultSchema } from "@quire/contracts";
import { Architecture } from "../../../../apps/web/src/features/admin/Architecture";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser } from "../../../ui-editor/shared/browser";

test("architecture projects supplied scale backend identities without inventing local adapters", () => {
  const topology = [
    { role: "API", backend: "Bun fixture", state: "ready" },
    { role: "Database", backend: "PostgreSQL", state: "ready" },
    { role: "Blobs", backend: "S3-compatible object storage", state: "configured" },
    { role: "Source repositories", backend: "Remote singleton Git repository service", state: "configured" },
  ];
  const overview = endpoints.adminOverview.output.parse({
    users: 0, projects: 0, storageBytes: 0, queuedJobs: 0, runningJobs: 0, capabilities: {}, topology,
  });
  const html = renderToStaticMarkup(createElement(Architecture, { overview }));
  for (const component of topology) expect(html).toContain(component.backend);
  expect(html).not.toContain("SQLite");
  expect(html).not.toContain("Local Git object store");
});

test("mounted architecture shows actual reported components at both responsive widths", async () => {
  const evidence = `docs/evidence/p32-architecture/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("ARCHITECTURE_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    const page = await operator.context.newPage();
    const overviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.adminOverview.path);
    await page.goto("/admin/architecture", { waitUntil: "domcontentloaded" });
    const response = await overviewResponse;
    expect(response.status()).toBe(200);
    const result = resultSchema(endpoints.adminOverview.output).parse(await response.json());
    if (!("data" in result)) throw new TypeError(result.error.code);
    await page.getByRole("heading", { name: "Server architecture", exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        const surface = page.locator(width === 390 ? ".admin-architecture-mobile" : ".admin-architecture svg");
        expect(await surface.isVisible()).toBe(true);
        const text = await surface.textContent();
        for (const component of result.data.topology) {
          expect(text).toContain(component.role);
          expect(text).toContain(component.backend);
          expect(text).toContain(component.state);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    console.info("ARCHITECTURE_REPORTED", result.data.topology);
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("ARCHITECTURE_CLOSED", { root, evidence });
}, 180_000);
