import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../ui-editor/shared";
import { openPanel, waitForAttribute } from "../ui-editor/review/browser-harness";

declare global {
  interface Window {
    shareReadRace: {
      release: () => void;
      completion: Promise<Response>;
      restore: () => void;
    };
  }
}

test("Share retains current capacity when an older real access response completes last", async () => {
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app, { viewport: { width: 1920, height: 900 } });
  await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
  const page = await owner.context.newPage();
  const evidence = `docs/evidence/p4-benefits-current/read-order-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  console.info("SHARE_ORDER_OWNED", { root: app.dataDir, web: app.url.origin, evidence });
  await openPanel(page, { view: "share", theme: "light" });
  await waitForRenderedText(page, "Unlimited capacity");
  // Buffer one actual authorized response and delay only its delivery.
  // No response body, grant, permission, or version is fabricated.
  await page.evaluate(() => {
    const original = window.fetch;
    const release = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<Response>();
    let hold = true;
    window.shareReadRace = {
      release: () => release.resolve(),
      completion: completed.promise,
      restore: () => { window.fetch = original; },
    };
    window.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
      if (!hold || !url.pathname.endsWith("/access")) return original(input, init);
      hold = false;
      const response = await original(input, init);
      const bytes = await response.arrayBuffer();
      document.body.dataset["accessHeld"] = "true";
      await release.promise;
      const delivered = new Response(bytes, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
      completed.resolve(delivered);
      return delivered;
    }, original);
  });
  try {
    await page.getByRole("button", { name: "Reload access" }).click();
    await waitForAttribute(page, { selector: "body", name: "data-access-held", value: "true" });
    const changed = await operator.context.request.put("/api/admin/project-benefits/deployment/local", {
      headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken },
      data: { expectedVersion: 0, benefits: { compileSeconds: 60, writableMembers: 1, historyDays: 7, trackChanges: false } },
    });
    expect(changed.status()).toBe(200);
    await waitForRenderedText(page, "Selection required.");
    await waitForRenderedText(page, "60 seconds");
    await page.screenshot({ path: `${evidence}/current-before-old-response.png` });
    // React's test boundary drains the released response's state updates;
    // no sleep, animation-frame count or polling assertion decides completion.
    await page.evaluate(async () => {
      await window.settleReviewEffects(async () => {
        window.shareReadRace.release();
        await window.shareReadRace.completion;
      });
    });
    await page.screenshot({ path: `${evidence}/after-old-response.png` });
    expect(await page.locator("[data-selection-required]").getAttribute("data-selection-required")).toBe("true");
    expect(await page.getByText("Unlimited capacity", { exact: false }).count()).toBe(0);
  } finally {
    await page.evaluate(() => {
      window.shareReadRace.release();
      window.shareReadRace.restore();
    });
  }
  console.info("SHARE_ORDER_COMPLETE", { root: app.dataDir, evidence });
}, 180_000);
