import { assistantApplication } from "./application";
import { assistantSettings } from "../shared/browser";
import { assistantBrowser, assistantIdle, evidenceDir } from "./browser";

async function captureConsent() {
  await using app = await assistantApplication({ termsVersion: "fixture-visual-terms-v7" });
  await using browser = await assistantBrowser(app);
  await browser.open();
  await assistantSettings(browser.page, true);
  await browser.page.getByText("AI preferences and consent", { exact: true }).click();
  await assistantIdle(browser.page);
  const name = "consent-after";
  const device = await browser.context.newCDPSession(browser.page);
  try {
    for (const width of [1440, 390]) {
      await browser.page.setViewportSize({ width, height: 900 });
      await device.send("Emulation.setDeviceMetricsOverride", {
        width, height: 900, deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390,
      });
      await device.send("Emulation.setTouchEmulationEnabled", { enabled: width === 390 });
      for (const colorScheme of ["light", "dark"] as const) {
        await browser.page.emulateMedia({ colorScheme });
        await browser.page.evaluate(() => {
          const body = document.querySelector(".qa-assistant__body");
          const settings = document.querySelector(".qa-assistant__settings");
          if (!body || !settings) throw new TypeError("Consent region missing");
          body.scrollTop += settings.getBoundingClientRect().top - body.getBoundingClientRect().top;
        });
        await browser.page.screenshot({ path: `${evidenceDir}/${name}-${width}-${colorScheme}.png` });
      }
    }
    await Bun.write(`${evidenceDir}/${name}-errors.json`, JSON.stringify(browser.errors, null, 2));
    if (browser.errors.length) throw new TypeError(`Browser errors: ${JSON.stringify(browser.errors)}`);
  } finally { await device.detach(); }
}
if (import.meta.main) await captureConsent();
