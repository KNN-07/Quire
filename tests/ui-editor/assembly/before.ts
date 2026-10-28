import { fileURLToPath } from "node:url";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticatedContext, startEditorApplication, startEditorBrowser } from "../shared";

const resources = new AsyncDisposableStack();
try {
  if (await Bun.file(new URL("./evidence/before/edit-1440-light.png", import.meta.url)).exists()) {
    throw new TypeError("The immutable pre-edit baseline already exists. Do not overwrite it with the mounted editor.");
  }
  const app = resources.use(await startEditorApplication());
  const browser = resources.use(await startEditorBrowser());
  console.info("ASSEMBLY_BASELINE_OWNED", {
    web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir,
  });
  for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"] as const) {
      await using actor = await authenticatedContext(browser, app, {
        viewport: { width, height: width === 390 ? 844 : 900 },
        isMobile: width === 390, hasTouch: width === 390,
        deviceScaleFactor: width === 390 ? 3 : 1, colorScheme: theme,
      });
      await actor.context.addInitScript(() => {
        const observer = new MutationObserver(() => {
          if (!document.querySelector("main h1")) return;
          observer.disconnect();
          console.info("ASSEMBLY_BASELINE_PAINT");
        });
        observer.observe(document, { subtree: true, childList: true });
      });
      for (const route of ["edit", "git", "agent", "history", "review", "logs", "pdf-diff"]) {
        const page = await actor.context.newPage();
        try {
          const ready = page.waitForEvent("console", {
            predicate: entry => entry.text() === "ASSEMBLY_BASELINE_PAINT",
            timeout: 30_000,
          });
          await Promise.all([
            ready,
            page.goto(`/projects/${fixtureIds.project}/${route}`, {
              waitUntil: "domcontentloaded", timeout: 30_000,
            }),
          ]);
          const path = fileURLToPath(new URL(
            `./evidence/before/${route}-${width}-${theme}.png`, import.meta.url,
          ));
          await page.screenshot({ path });
          console.info("ASSEMBLY_BASELINE_CAPTURE", {
            route, width, theme, path,
            heading: await page.locator("main h1").textContent(),
          });
        } finally {
          await page.close();
        }
      }
    }
  }
} finally {
  await resources.disposeAsync();
  console.info("ASSEMBLY_BASELINE_RESOURCES_CLOSED");
}
