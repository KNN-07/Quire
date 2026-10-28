import { expect, test } from "bun:test";
import { endpoints } from "@quire/contracts";
import { connectionApplication } from "./application";
import { startEditorBrowser } from "../ui-editor/shared/browser";
import { capture, contextFor, responseData, waitForRenderedText } from "./helpers";

test("shows actual unconfigured requirements in both themes and widths", async () => {
  // Given the actual aggregate with no encrypted operator configuration.
  await using app = await connectionApplication();
  await using ownedBrowser = await startEditorBrowser();
  const session = await app.login();
  const consoleErrors: string[] = [], pageErrors: string[] = [];
  try {
    for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
      const context = await contextFor(ownedBrowser.browser, { app, session }, {
        viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme,
        isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
      });
      try {
        const page = await context.newPage();
        page.on("console", entry => { if (entry.type() === "error") consoleErrors.push(entry.text()); });
        page.on("pageerror", error => pageErrors.push(error.message));
        // When the production account route loads.
        await page.goto("/settings/git");
        await waitForRenderedText(page, "No saved connections.");
        // Then readiness and requirements come from the actual adapter availability.
        expect(await page.getByRole("button", { name: "Connect Zotero", exact: true }).isDisabled()).toBe(true);
        const availability = await responseData(await context.request.get("/api/connections/availability"), endpoints.connectionAvailability.output);
        for (const provider of ["github", "gitlab", "zotero", "mendeley", "dropbox", "git"]) {
          expect(availability[provider]?.enabled).toBe(false);
          expect(await page.getByRole("list", { name: "Connection providers" }).innerText()).toContain(availability[provider]?.reason ?? "");
        }
        await capture(page, `connections-unconfigured-${width}-${colorScheme}-after`);
      } finally { await context.close(); }
    }
    expect(pageErrors).toEqual([]);
  } finally { console.info("AVAILABILITY_BROWSER_ERRORS", { consoleErrors, pageErrors }); }
}, 120000);
