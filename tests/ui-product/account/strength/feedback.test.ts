import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { connectionApplication } from "../../../ui-integrations/application";
import { startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { readLocalMail } from "../../../../services/accounts/identity/mail";

const evidence = resolve(import.meta.dir, "../../../../docs/evidence/p6-password-feedback");

async function submit(page: Page, path: string, button: string) {
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === path
    && entry.request().method() === "POST", { timeout: 30_000 });
  await page.getByRole("button", { name: button, exact: true }).click();
  return response;
}

async function fieldState(field: Locator) {
  return field.evaluate((input: HTMLInputElement) => {
    const hint = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    const status = hint?.querySelector('[role="status"]');
    const segments = [...hint?.querySelectorAll('[aria-hidden="true"] > span') ?? []];
    return {
      required: input.required, min: input.minLength, max: input.maxLength,
      type: input.type, autocomplete: input.autocomplete, valid: input.validity.valid,
      described: Boolean(hint), live: status?.getAttribute("aria-live"),
      atomic: status?.getAttribute("aria-atomic"), text: status?.textContent,
      active: segments.filter(segment => segment instanceof HTMLElement && segment.style.background === "var(--q-brand)").length,
      segments: segments.length,
    };
  });
}

async function feedback(page: Page, field: Locator) {
  const empty = await fieldState(field);
  expect(empty).toMatchObject({
    required: true, min: 12, max: 1024, type: "password", autocomplete: "new-password",
    valid: false, described: true, live: "polite", atomic: "true", active: 0, segments: 4,
  });
  expect(empty.text?.length).toBeGreaterThan(0);
  for (const [length, active, valid] of [[1, 1, false], [11, 1, false], [12, 2, true], [16, 3, true], [24, 4, true], [1024, 4, true]] as const) {
    await field.fill("a".repeat(length));
    expect(await fieldState(field)).toMatchObject({ active, valid, type: "password", segments: 4 });
  }
  expect((await fieldState(field)).text).not.toBe(empty.text);
  await field.fill("");
  expect(await fieldState(field)).toMatchObject({ active: 0, valid: false, text: empty.text });
  await field.focus();
  const announcement = await field.evaluateHandle((input: HTMLInputElement) => {
    const status = document.getElementById(input.getAttribute("aria-describedby") ?? "")?.querySelector('[role="status"]');
    if (!status) throw new Error("Associated password live region missing");
    return { changed: new Promise<void>((ready, reject) => {
      const observer = new MutationObserver(() => {
        observer.disconnect(); clearTimeout(deadline); ready();
      });
      const deadline = setTimeout(() => {
        observer.disconnect(); reject(new Error("Password live region did not update"));
      }, 30_000);
      observer.observe(status, { subtree: true, childList: true, characterData: true });
    }) };
  });
  await page.keyboard.type("aaaaaaaaaaaa");
  await announcement.evaluate(async observed => { await observed.changed; });
  await announcement.dispose();
  expect(await fieldState(field)).toMatchObject({ active: 2, valid: true });
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true });
}

test("live creation/reset feedback preserves real password and one-time token behavior", async () => {
  let dataDir = "";
  {
    await using app = await connectionApplication();
    dataDir = app.dataDir;
    await using browser = await startEditorBrowser();
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      const page = await context.newPage();
      const mutations: string[] = [];
      page.on("request", request => {
        if (request.method() === "POST") mutations.push(new URL(request.url()).pathname);
      });
      const signup = "/api/auth/register";
      const confirm = "/api/auth/password-reset/confirm";
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme });
          await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
          const password = page.getByLabel("Password", { exact: true });
          await password.waitFor({ state: "visible", timeout: 30_000 });
          const optionsReady = page.getByRole("button", { name: "Create account", exact: true });
          await optionsReady.waitFor({ state: "visible", timeout: 30_000 });
          // A bounded exact DOM subscription also handles the auth-options response.
          await page.evaluate(() => new Promise<void>((ready, reject) => {
            const observer = new MutationObserver(check);
            const deadline = setTimeout(() => { observer.disconnect(); reject(new Error("Password options unavailable")); }, 30_000);
            function check() {
              if (document.querySelector<HTMLInputElement>('input[name="password"]')?.disabled) return;
              observer.disconnect(); clearTimeout(deadline); ready();
            }
            observer.observe(document.body, { subtree: true, attributes: true });
            check();
          }));
          await feedback(page, password);
          await capture(page, `signup-${width}-${colorScheme}`);
        }
      }
      expect(mutations).toEqual([]);
      await page.getByLabel("Full name", { exact: true }).fill("Password Feedback Fixture");
      const email = `strength-${crypto.randomUUID()}@example.test`;
      await page.getByLabel("Email", { exact: true }).fill(email);
      const registered = await submit(page, signup, "Create account");
      expect(registered.status()).toBe(200);
      await waitForRenderedText(page, "Verify your email");
      const verification = readLocalMail(app.dataDir).find(entry => entry.recipient === email);
      if (!verification) throw new Error("Owned registration verification mail missing");
      const verificationToken = new URL(verification.body.split("\n")[0] ?? "").searchParams.get("token");
      const verified = await context.request.post("/api/auth/verify-email", {
        headers: { origin: app.url.origin }, data: { token: verificationToken },
      });
      expect(verified.status()).toBe(200);
      const registeredLogin = await context.request.post("/api/auth/login", {
        headers: { origin: app.url.origin }, data: { email, password: "aaaaaaaaaaaa" },
      });
      expect(registeredLogin.status()).toBe(200);
      await context.clearCookies();

      await page.goto("/reset-password", { waitUntil: "domcontentloaded" });
      await page.getByLabel("Email", { exact: true }).fill("kien@quire.local");
      const requested = await submit(page, "/api/auth/password-reset", "Send reset link");
      expect(requested.status()).toBe(200);
      await waitForRenderedText(page, "Check your inbox");
      const mail = readLocalMail(app.dataDir).find(entry => entry.recipient === "kien@quire.local"
        && entry.subject === "Reset your Quire password");
      if (!mail) throw new Error("Owned local reset mail missing");
      const reset = new URL(mail.body.split("\n")[0] ?? "");
      expect(reset.origin).toBe(app.url.origin);
      const resetPath = reset.pathname + reset.search;
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme });
          await page.goto(resetPath, { waitUntil: "domcontentloaded" });
          const password = page.getByLabel("New password", { exact: true });
          await password.waitFor({ state: "visible", timeout: 30_000 });
          await feedback(page, password);
          await page.keyboard.press("Tab");
          expect(await page.getByLabel("Confirm password", { exact: true }).evaluate(input => input === document.activeElement)).toBe(true);
          await capture(page, `reset-${width}-${colorScheme}`);
        }
      }
      const beforeConfirm = mutations.filter(path => path === confirm).length;
      await page.getByLabel("Confirm password", { exact: true }).fill("bbbbbbbbbbbb");
      await page.getByRole("button", { name: "Save new password", exact: true }).click();
      await waitForRenderedText(page, "Passwords do not match.");
      expect(mutations.filter(path => path === confirm).length).toBe(beforeConfirm);
      await page.getByLabel("Confirm password", { exact: true }).fill("aaaaaaaaaaaa");
      const saved = await submit(page, confirm, "Save new password");
      expect(saved.status()).toBe(200);
      await waitForRenderedText(page, "Password updated");
      await capture(page, "reset-complete");
      const replay = await context.request.post(confirm, {
        headers: { origin: app.url.origin }, data: { token: reset.searchParams.get("token"), password: "aaaaaaaaaaaa" },
      });
      expect(replay.status()).toBe(400);
      const oldLogin = await context.request.post("/api/auth/login", {
        headers: { origin: app.url.origin }, data: { email: "kien@quire.local", password: app.password },
      });
      expect(oldLogin.status()).toBe(401);
      const newLogin = await context.request.post("/api/auth/login", {
        headers: { origin: app.url.origin }, data: { email: "kien@quire.local", password: "aaaaaaaaaaaa" },
      });
      expect(newLogin.status()).toBe(200);
      console.info("PASSWORD_FEEDBACK_VERIFIED", { captures: 9, resetReplay: replay.status(), oldLogin: oldLogin.status(), newLogin: newLogin.status() });
    } finally { await context.close(); }
  }
  expect(await access(dataDir).then(() => false, () => true)).toBe(true);
  console.info("PASSWORD_FEEDBACK_CLEANED", dataDir);
}, 180_000);
