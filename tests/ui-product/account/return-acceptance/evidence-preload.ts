import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

// Preserve producer tests byte-for-byte while keeping generated captures owned.
const launch = chromium.launch.bind(chromium);
chromium.launch = async launchOptions => {
  const browser = await launch(launchOptions);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async contextOptions => {
    const context = await newContext(contextOptions);
    context.on("page", page => {
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async captureOptions => {
        const original = captureOptions?.path;
        if (!original) return screenshot(captureOptions);
        const producer = ["p6-checkout-ui", "p6-identity-ui", "p6-password-feedback"]
          .find(name => resolve(original).includes(`/docs/evidence/${name}/`));
        if (!producer) throw new Error(`Unexpected screenshot destination: ${original}`);
        const path = resolve("docs/evidence/p6-account-verification",
          process.env["QUIRE_ACCOUNT_EVIDENCE_RUN"] ?? ".", producer, basename(original));
        await mkdir(dirname(path), { recursive: true });
        const image = await screenshot({ ...captureOptions, path });
        console.info("INDEPENDENT_CAPTURE", {
          path, url: page.url(),
          bounds: await page.evaluate(() => ({
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          })),
        });
        return image;
      };
    });
    return context;
  };
  browser.on("disconnected", () => console.info("INDEPENDENT_BROWSER_DISCONNECTED"));
  return browser;
};
