import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type * as Harness from "./browser-entry";

export const sourceEntry = "/@fs" + fileURLToPath(new URL("./evidence/browser/browser-entry.js", import.meta.url));
export const sourceHtml = "/@fs" + fileURLToPath(new URL("./browser.html", import.meta.url));
let bundle: Promise<void> | null = null;
export function buildSourceFixture(): Promise<void> {
  bundle ??= Bun.build({
    entrypoints: [fileURLToPath(new URL("./browser-entry.tsx", import.meta.url))],
    outdir: fileURLToPath(new URL("./evidence/browser", import.meta.url)), target: "browser",
    naming: { entry: "[name].[ext]", asset: "[name]-[hash].[ext]" }, minify: true,
    define: { "process.env.NODE_ENV": "\"production\"" },
  }).then(result => {
    if (!result.success) throw new AggregateError(result.logs, "Source browser fixture build failed");
    console.info("SOURCE_BROWSER_BUILD", result.outputs.map(output => output.path));
  });
  return bundle;
}
export async function sourceReady(page: Page) {
  await page.evaluate(async path => {
    const harness: typeof Harness = await import(path);
    await harness.ready;
  }, sourceEntry);
}
export async function sourceClose(page: Page) {
  await page.evaluate(async path => {
    const harness: typeof Harness = await import(path);
    await harness.close();
  }, sourceEntry);
}
export function sourceBrowserErrors(page: Page): readonly string[] {
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error("SOURCE_BROWSER_ERROR", error.stack); });
  page.on("console", message => { if (message.type() === "error") { errors.push(message.text()); console.error("SOURCE_BROWSER_CONSOLE", message.text()); } });
  return errors;
}
