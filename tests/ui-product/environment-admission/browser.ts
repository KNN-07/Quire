import { expect } from "bun:test";
import { writeFile } from "node:fs/promises";
import type { Browser, Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";

async function screenshots(page: Page, directory: string, name: string, prepare?: () => Promise<void>) {
  for (const width of [1440, 390]) {
    console.info("ENVIRONMENT_ADMISSION_VIEWPORT", { name, width });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await prepare?.();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${directory}/${name}-${width}-${colorScheme}.png`, fullPage: true });
      console.info("ENVIRONMENT_ADMISSION_CAPTURED", { name, width, colorScheme });
    }
  }
}

export async function admissionBrowser(input: {
  readonly browser: Browser; readonly url: string; readonly userCookie: string; readonly operatorCookie: string;
  readonly environment: Environment; readonly directory: string; readonly admitted: boolean;
}) {
  const context = await input.browser.newContext({ baseURL: input.url, viewport: { width: 1440, height: 1000 } });
  const prefix = input.admitted ? "admitted" : "not-admitted";
  let currentPage: Page | undefined;
  let stage = "create";
  const failures: { readonly stage: string; readonly error: unknown }[] = [];
  const disconnected = () => console.error("ENVIRONMENT_ADMISSION_BROWSER_DISCONNECTED", { prefix, stage });
  input.browser.on("disconnected", disconnected);
  try {
    const cookie = (raw: string) => {
      const boundary = raw.indexOf("=");
      return { name: raw.slice(0, boundary), value: raw.slice(boundary + 1), url: input.url, httpOnly: true, sameSite: "Lax" as const };
    };
    await context.addCookies([cookie(input.userCookie)]);
    const page = await context.newPage();
    currentPage = page;
    page.on("crash", () => console.error("ENVIRONMENT_ADMISSION_PAGE_CRASH", { prefix, stage }));
    page.on("close", () => console.info("ENVIRONMENT_ADMISSION_PAGE_CLOSED", { prefix, stage }));
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    const admissionResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === endpoints.environmentsAdmission.path);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByRole("tab", { name: "Blank", exact: true }).click();
    const received = await admissionResponse;
    const receivedBody: unknown = await received.json();
    const selector = page.getByLabel("TeX Live version", { exact: true });
    const custom = selector.locator(`option[value="${input.environment.id}"]`);
    await custom.waitFor({ state: "attached" });
    const rendered = await selector.evaluate(node => node.outerHTML);
    await writeFile(`${input.directory}/${prefix}-picker-observation.json`,
      JSON.stringify({ status: received.status(), response: receivedBody, rendered }, null, 2));
    await page.screenshot({ path: `${input.directory}/${prefix}-picker-first.png`, fullPage: true });
    expect(await custom.evaluate(node => node instanceof HTMLOptionElement && node.disabled)).toBe(!input.admitted);
    if (input.admitted) await selector.selectOption(input.environment.id);
    await screenshots(page, input.directory, `${prefix}-create`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    stage = "settings";
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/projects/${fixtureIds.project}/edit`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    const assistant = page.locator(".qe-header").getByRole("button", { name: "Assistant", exact: true });
    if (await assistant.getAttribute("aria-pressed") === "true") await assistant.click();
    const settings = page.getByRole("region", { name: "Project settings", exact: true });
    const settingsOption = settings.getByLabel("TeX environment", { exact: true }).locator(`option[value="${input.environment.id}"]`);
    await settingsOption.waitFor({ state: "attached" });
    expect(await settingsOption.evaluate(node => node instanceof HTMLOptionElement && node.disabled)).toBe(!input.admitted);
    if (input.admitted) await settings.getByLabel("TeX environment", { exact: true }).selectOption(input.environment.id);
    await screenshots(page, input.directory, `${prefix}-settings`, async () => {
      await settings.waitFor({ state: "visible" });
      const choice = settings.getByLabel("TeX environment", { exact: true });
      await choice.locator(`option[value="${input.environment.id}"]`).waitFor({ state: "attached" });
      if (input.admitted) await choice.selectOption(input.environment.id);
      expect(await settings.getByRole("alert").count()).toBe(0);
    });
    if (input.admitted) {
      const patched = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/projects/${fixtureIds.project}` && response.request().method() === "PATCH");
      await settings.getByRole("button", { name: "Save project settings", exact: true }).click();
      const response = await patched;
      expect(response.status()).toBe(200);
      const result = resultSchema(endpoints.projectPatch.output).parse(await response.json());
      if (!("data" in result)) throw new Error(result.error.code);
      expect(result.data.settings.environmentId).toBe(input.environment.id);
    }
    await context.clearCookies();
    await context.addCookies([cookie(input.operatorCookie)]);
    stage = "operator";
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/tex", { waitUntil: "domcontentloaded" });
    const row = page.getByRole("row").filter({ hasText: input.environment.label });
    await row.getByText(input.admitted ? "Signed execution admitted" : "Signed admission required", { exact: true }).waitFor();
    expect(await row.getByRole("button", { name: "Set default", exact: true }).isDisabled()).toBe(!input.admitted);
    await screenshots(page, input.directory, `${prefix}-operator`);
    console.info("ENVIRONMENT_ADMISSION_UI", { admitted: input.admitted, environment: input.environment.id,
      url: input.url, directory: input.directory, screenshots: 12 });
  } catch (error) {
    failures.push({ stage, error });
    console.error("ENVIRONMENT_ADMISSION_ACTION_FAILED", { prefix, stage,
      error: error instanceof Error ? error.stack ?? error.message : String(error) });
    if (currentPage && !currentPage.isClosed()) {
      try {
        await currentPage.screenshot({ path: `${input.directory}/${prefix}-failure.png`, fullPage: true });
        await writeFile(`${input.directory}/${prefix}-failure.html`, await currentPage.content());
      } catch (captureError) {
        failures.push({ stage: `${stage}:capture`, error: captureError });
      }
    }
  } finally {
    stage = "cleanup";
    try { await context.close(); }
    catch (error) { failures.push({ stage, error }); }
    finally { input.browser.off("disconnected", disconnected); }
  }
  if (failures.length) {
    try {
      await writeFile(`${input.directory}/${prefix}-failures.json`, JSON.stringify(failures.map(failure => ({
        stage: failure.stage,
        error: failure.error instanceof Error ? failure.error.stack ?? failure.error.message : String(failure.error),
      })), null, 2));
    } catch (error) { failures.push({ stage: "failure-receipt", error }); }
    throw new AggregateError(failures.map(failure => failure.error),
      `Environment admission ${prefix} failed at ${failures[0]?.stage}`);
  }
}
