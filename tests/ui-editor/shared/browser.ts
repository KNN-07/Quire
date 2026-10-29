import { chromium } from "@playwright/test";
import type { BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import type { EditorApplication } from "./application";
import { authenticateApi } from "./api-session";

export type EditorBrowser = Awaited<ReturnType<typeof startEditorBrowser>>;
/** Use the installed Playwright browser, or explicitly select an owned compatible executable. */
export async function startEditorBrowser() {
  const executablePath = process.env["QUIRE_TEST_CHROMIUM"];
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {}),
  });
  return { browser, async [Symbol.asyncDispose]() { await browser.close(); } };
}
export async function authenticatedContext(
  browser: EditorBrowser,
  app: EditorApplication,
  options: BrowserContextOptions & { readonly email?: string } = {},
) {
  const { email = "kien@quire.local", ...contextOptions } = options;
  const context = await browser.browser.newContext({ baseURL: app.url.origin, ...contextOptions });
  try {
    const actor = await authenticateApi(app, email);
    await context.addCookies([actor.cookie]);
    return { context, session: actor.session, async [Symbol.asyncDispose]() { await context.close(); } };
  } catch (error) {
    await context.close();
    throw error;
  }
}
/** Subscribes before navigation; matches the exact project request rather than network idle. */
export async function openProjects(page: Page) {
  const response = page.waitForResponse(
    entry => new URL(entry.url()).pathname === endpoints.projectList.path
      && entry.request().method() === "GET", { timeout: 30_000 },
  );
  await page.goto("/projects", { waitUntil: "domcontentloaded", timeout: 30_000 });
  return editorValue(resultSchema(endpoints.projectList.output).parse(await (await response).json()));
}
/** A bounded DOM mutation subscription, not a sleep or retrying assertion. */
export async function waitForRenderedText(page: Page, text: string): Promise<void> {
  await page.evaluate(expected => new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Rendered text not observed: ${expected}`));
    }, 30_000);
    function check() {
      if (!document.body.innerText.includes(expected)) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolve();
    }
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    check();
  }), text);
}
export async function projectDocument(context: BrowserContext, scope: Scope & { readonly fileId: Id }) {
  const response = await context.request.get(
    `/api/projects/${encodeURIComponent(scope.projectId)}/files/${encodeURIComponent(scope.fileId)}/document`,
    { params: { branch: scope.branch }, timeout: 30_000 },
  );
  return editorValue(resultSchema(endpoints.fileDocument.output).parse(await response.json()));
}

/** Show or hide the assistant settings view (privacy, preferences, consent) behind the header toggle. */
export async function assistantSettings(page: Page, open: boolean): Promise<void> {
  const toggle = page.locator(".qa-assistant__header").getByRole("button", { name: "Assistant settings", exact: true });
  if ((await toggle.getAttribute("aria-pressed") === "true") !== open) await toggle.click();
}
