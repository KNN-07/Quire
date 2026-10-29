import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import type { Page } from "@playwright/test";
import { assistantSettings, startEditorBrowser, waitForRenderedText } from "../shared/browser";
import type { assistantApplication } from "./application";

export const evidenceDir = resolvePath("tests/ui-editor/assistant/evidence");
export function aiCompletion(app: Awaited<ReturnType<typeof assistantApplication>>) {
  const finished = Promise.withResolvers<void>();
  const signal = AbortSignal.timeout(30_000);
  const unsubscribe = app.runtime.events.subscribe(event => {
    if (event.topic !== "operation.changed" || !["succeeded", "failed", "canceled", "timeout"].includes(event.payload.status)) return;
    unsubscribe(); signal.removeEventListener("abort", abort); finished.resolve();
  });
  const abort = () => { unsubscribe(); finished.reject(new TypeError("AI terminal fixture event deadline")); };
  signal.addEventListener("abort", abort, { once: true });
  return { done: finished.promise, [Symbol.dispose]() { unsubscribe(); signal.removeEventListener("abort", abort); } };
}
/** A real explicit Refresh, not client polling or a fabricated provider completion. */
export async function sendAndRefresh(page: Page, app: Awaited<ReturnType<typeof assistantApplication>>) {
  using finished = aiCompletion(app);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await finished.done;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
}
export async function assistantBrowser(app: Awaited<ReturnType<typeof assistantApplication>>) {
  const owned = await startEditorBrowser();
  const context = await owned.browser.newContext({ baseURL: app.url.origin });
  await context.addCookies([app.owner.cookie]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(`console.error: ${message.text()}`); });
  page.on("pageerror", error => errors.push(`pageerror: ${error.stack ?? error.message}`));
  await mkdir(evidenceDir, { recursive: true });
  return { page, context, errors,
    async open() {
      await page.goto(`/?project=${app.project.id}`, { waitUntil: "domcontentloaded" });
      try { await page.locator(".qa-assistant__composer").waitFor({ state: "visible", timeout: 30_000 }); }
      catch (failure) {
        await page.screenshot({ path: `${evidenceDir}/open-failed-${app.project.id}.png` });
        throw failure;
      }
    },
    async [Symbol.asyncDispose]() {
      await Bun.write(`${evidenceDir}/raw-errors-${app.project.id}.json`, JSON.stringify(errors, null, 2));
      await context.close(); await owned[Symbol.asyncDispose]();
    },
  };
}
export async function consent(page: Page) {
  await assistantSettings(page, true);
  await page.getByText("AI preferences and consent", { exact: true }).click();
  await page.getByLabel("I consent to these provider terms").check();
  await page.getByRole("button", { name: "Save consent decision" }).click();
  await waitForRenderedText(page, "Consent accepted");
  await page.getByText("AI preferences and consent", { exact: true }).click();
  await assistantSettings(page, false);
}
export async function generate(page: Page, app: Awaited<ReturnType<typeof assistantApplication>>) {
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByLabel("Tool", { exact: true }).selectOption("texgpt");
  await page.getByText("Context ·", { exact: false }).click();
  await page.getByRole("group", { name: "Selected files" }).getByLabel("main.tex", { exact: true }).check();
  await page.getByLabel("Message the assistant").fill("Add a reviewed comment");
  await sendAndRefresh(page, app);
  await waitForRenderedText(page, "Agent run · succeeded");
}
export async function assistantIdle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(check);
    const deadline = setTimeout(() => { observer.disconnect(); reject(new TypeError("Assistant action did not settle")); }, 30_000);
    function check() {
      const button = [...document.querySelectorAll("button")].find(item => item.textContent === "Refresh");
      if (!button || button.disabled) return;
      observer.disconnect(); clearTimeout(deadline); resolve();
    }
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    check();
  }));
}
export async function capture(page: Page, name: string) {
  await assistantIdle(page);
  const device = await page.context().newCDPSession(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await device.send("Emulation.setDeviceMetricsOverride", {
      width, height: 900, deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390,
    });
    await device.send("Emulation.setTouchEmulationEnabled", { enabled: width === 390 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => { const body = document.querySelector(".qa-assistant__body"); if (body) body.scrollTop = 0; });
      await page.screenshot({ path: `${evidenceDir}/${name}-${width}-${colorScheme}-top.png` });
      const overflow = await page.evaluate(() => ({
        viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
        scrollers: [...document.querySelectorAll("*")].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY)
          && el.scrollHeight > el.clientHeight).map(el => el.className),
      }));
      if (overflow.documentWidth > overflow.viewport) throw new TypeError(`Horizontal overflow: ${JSON.stringify(overflow)}`);
      await Bun.write(`${evidenceDir}/${name}-${width}-${colorScheme}-layout.json`, JSON.stringify(overflow, null, 2));
      await page.evaluate(() => { const body = document.querySelector(".qa-assistant__body"); if (body) body.scrollTop = body.scrollHeight; });
      await page.screenshot({ path: `${evidenceDir}/${name}-${width}-${colorScheme}-end.png` });
    }
  }
  await device.detach();
}
