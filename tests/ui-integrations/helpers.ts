import { expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import type { connectionApplication } from "./application";
import { waitForRenderedText } from "../ui-editor/shared/browser";

export type Application = Awaited<ReturnType<typeof connectionApplication>>;
export type Session = Awaited<ReturnType<Application["login"]>>;
export async function contextFor(browser: Browser, actor: { readonly app: Application; readonly session: Session }, options: BrowserContextOptions = {}) {
  const { app, session } = actor;
  const context = await browser.newContext({
    baseURL: app.url.origin, viewport: { width: 1440, height: 900 }, colorScheme: "light", ...options,
  });
  context.on("response", response => {
    if (response.status() < 500) return;
    void response.text().then(body => console.info("CONNECTIONS_HTTP_FAILURE", {
      url: response.url(), status: response.status(), body,
    })).catch((error: unknown) => {
      if (error instanceof Error) console.info("CONNECTIONS_HTTP_FAILURE_BODY_UNAVAILABLE", { url: response.url(), error: error.message });
      else throw error;
    });
  });
  const [name, value] = session.headers.cookie.split("=");
  if (!name || !value) throw new TypeError("Cookie required");
  await context.addCookies([{ name, value, url: app.url.origin }]);
  return context;
}
export async function responseData<T extends z.ZodType>(response: { readonly json: () => Promise<unknown> }, schema: T): Promise<z.output<T>> {
  const envelope = z.object({ data: z.unknown() }).parse(await response.json());
  return schema.parse(envelope.data);
}
export async function configure(app: Application, session: Session, settings: {
  readonly kind: string; readonly baseUrl: string; readonly model?: string; readonly secret?: string;
}) {
  const { kind, ...body } = settings;
  console.info("CONNECTIONS_CONFIGURE_START", kind);
  const response = await fetch(new URL(`/api/admin/providers/${kind}`, app.url), {
    method: "PUT", headers: { ...session.headers, origin: app.url.origin, "content-type": "application/json", "if-match": '"0"' },
    body: JSON.stringify({ ...body, expectedVersion: 0, policy: {
      compileSeconds: 60, writableMembers: null, historyDays: null, trackChanges: true, chat: true,
      ai: "off", aiDailyUses: null, sharing: "named", anonymousRead: false, anonymousEdit: false,
    } }), signal: AbortSignal.timeout(30_000),
  });
  expect(response.status).toBe(200);
  console.info("CONNECTIONS_CONFIGURE_SAVED", kind);
}
export async function changed(page: Page, path: string, action: () => Promise<unknown>) {
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === path && entry.request().method() !== "GET");
  await action(); return response;
}
export async function capture(page: Page, name: string) {
  await mkdir(join(import.meta.dir, "evidence"), { recursive: true });
  await page.screenshot({ path: join(import.meta.dir, "evidence", `${name}.png`), fullPage: true });
  const scrollOwners = await page.evaluate(() => [...document.querySelectorAll("*")]
    .filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)
    .map(el => el.tagName.toLowerCase() + (el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : ""))
    .concat(document.documentElement.scrollHeight > innerHeight ? ["document"] : []));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  console.info("CONNECTIONS_CAPTURE", { name, scrollOwners });
}
export { waitForRenderedText };

export async function completeOAuth(page: Page, provider: { readonly id: string; readonly label: string }) {
  const origin = new URL(page.url()).origin;
  const navigated = page.waitForEvent("framenavigated", {
    predicate: frame => frame === page.mainFrame() && frame.url() === `${origin}/settings/git`,
  });
  const callback = page.waitForResponse(response => new URL(response.url()).pathname === `/api/connections/${provider.id}/callback`);
  await page.getByRole("button", { name: `Connect ${provider.label}`, exact: true }).click();
  await navigated;
  await page.waitForLoadState("domcontentloaded");
  return callback;
}
