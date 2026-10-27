import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import { seed } from "../../../scripts/seed";
import { password } from "./harness";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = await mkdtemp(join(tmpdir(), "quire-p1-browser-"));
const assets = join(repository, "dist/web");
const evidence = join(repository, "docs/evidence/p1-integration");
const ready = Promise.withResolvers<Awaited<ReturnType<typeof createApplication>>>();
const server = Bun.serve<RealtimeSocketData>({
  hostname: "127.0.0.1", port: 0,
  async fetch(request, listener) {
    const app = await ready.promise;
    const pathname = new URL(request.url).pathname;
    if (["/api/", "/git/", "/internal/", "/scim/"].some(prefix => pathname.startsWith(prefix))) return app.handle(request, listener);
    const path = resolve(assets, pathname.slice(1));
    if (!path.startsWith(assets + "/")) return new Response(Bun.file(join(assets, "index.html")));
    const file = Bun.file(path);
    return new Response(await file.exists() ? file : Bun.file(join(assets, "index.html")));
  },
  websocket: {
    async message(socket, message) { await (await ready.promise).websocket.message(socket, message); },
  },
});
const app = await createApplication({ config: loadConfig({
  QUIRE_DATA_DIR: root, QUIRE_PUBLIC_URL: server.url.origin,
}) });
ready.resolve(app);
await seed(app.runtime, password);
await app.start();
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(server.url.origin);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.screenshot({ path: join(evidence, `landing-${width}.png`), fullPage: true });
      await page.getByRole("link", { name: "Sign in", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).fill("kien@quire.local");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.screenshot({ path: join(evidence, `sign-in-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/projects$/);
      await expect(page.getByRole("button", { name: "Latent Dynamics Note", exact: true })).toBeVisible();
      await page.screenshot({ path: join(evidence, `projects-${width}.png`), fullPage: true });
      if (width === 1440) {
        await page.getByRole("button", { name: "Blank project", exact: true }).click();
        await page.getByLabel("Project name", { exact: true }).fill("Browser P1 persisted project");
        const created = page.waitForResponse(response => response.url().endsWith("/api/projects") && response.request().method() === "POST");
        await page.getByRole("button", { name: "Create project", exact: true }).click();
        expect((await created).status()).toBe(200);
        await expect(page).toHaveURL(/\/projects\/[^/]+\/edit$/);
        await expect(page.getByRole("heading", { name: "Editor workspace unavailable" })).toBeVisible();
        await page.getByRole("button", { name: "Back to projects" }).click();
        await expect(page.getByRole("button", { name: "Browser P1 persisted project", exact: true })).toBeVisible();
      }
      await page.goto(new URL("/settings/profile", server.url).href);
      await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
      await page.screenshot({ path: join(evidence, `settings-${width}.png`), fullPage: true });
      await page.goto(new URL("/settings/connections", server.url).href);
      await expect(page.getByRole("heading", { name: "Git & integrations", exact: true })).toBeVisible();
      await page.goto(new URL("/verify-email?token=invalid", server.url).href);
      await expect(page.getByLabel("Verification token")).toHaveValue("invalid");
      await page.goto(new URL("/admin/users", server.url).href);
      await expect(page.getByRole("heading", { name: "Operator access denied" })).toBeVisible();
      await page.screenshot({ path: join(evidence, `admin-denied-${width}.png`), fullPage: true });
      const operatorContext = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        isMobile: width === 390, hasTouch: width === 390,
      });
      try {
        const operatorPage = await operatorContext.newPage();
        await operatorPage.goto(new URL("/sign-in", server.url).href);
        await operatorPage.getByLabel("Email", { exact: true }).fill("operator@quire.local");
        await operatorPage.getByLabel("Password", { exact: true }).fill(password);
        await operatorPage.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(operatorPage).toHaveURL(/\/projects$/);
        await operatorPage.goto(new URL("/admin/users", server.url).href);
        await expect(operatorPage.getByRole("heading", { name: "Users & groups", exact: true })).toBeVisible();
        const ownerRow = operatorPage.getByRole("row").filter({ hasText: "kien@quire.local" });
        await expect(ownerRow).toBeVisible();
        await ownerRow.getByRole("button", { name: /^Manage / }).click();
        await operatorPage.getByRole("dialog").getByLabel("Full name", { exact: true }).fill(`Kien verified ${width}`);
        const saved = operatorPage.waitForResponse(response => response.url().includes("/api/admin/users/") && response.request().method() === "PATCH");
        await operatorPage.getByRole("button", { name: "Save changes", exact: true }).click();
        expect((await saved).status()).toBe(200);
        await expect(operatorPage.getByRole("dialog")).toBeHidden();
        await expect(ownerRow).toContainText(`Kien verified ${width}`);
        await operatorPage.screenshot({ path: join(evidence, `admin-${width}.png`), fullPage: true });
        await operatorPage.goto(new URL("/admin/audit", server.url).href);
        await expect(operatorPage.getByRole("cell", { name: /admin\.user\.updated$/ }).first()).toBeVisible();
        expect(await operatorPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        console.info("P1_NATIVE_ADMIN_PASS", { width, savedUser: true, auditVisible: true });
      } finally { await operatorContext.close(); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      console.info("P1_BROWSER_PASS", { width, pages: ["landing", "sign-in", "projects", "settings", "verify-email", "admin"] });
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  server[Symbol.dispose](); server.unref();
  await app.close();
  await rm(root, { recursive: true, force: true });
  console.info("P1_BROWSER_CLEANED", root);
}
