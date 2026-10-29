import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { parseResourceVersionTag, resourceVersionTag } from "@quire/contracts";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser } from "../../../ui-editor/shared/browser";

test("dashboard avatar follows each authenticated account and reloads its saved photo", async () => {
  const evidence = `docs/evidence/p33-dashboard-avatar/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("DASHBOARD_AVATAR_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    await using colleague = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    const page = await owner.context.newPage();
    const other = await colleague.context.newPage();
    await Promise.all([page.goto("/projects"), other.goto("/projects")]);
    const account = page.locator(".q-header__actions").getByRole("button", { name: "Account settings", exact: true });
    const otherAccount = other.locator(".q-header__actions").getByRole("button", { name: "Account settings", exact: true });
    await account.locator(".p-account-avatar").waitFor();
    await otherAccount.locator(".p-account-avatar").waitFor();
    expect(await account.locator(".p-account-avatar").textContent()).toBe("KN");
    expect(await otherAccount.locator(".p-account-avatar").textContent()).toBe("MT");
    const data = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
      const drawing = canvas.getContext("2d");
      if (!drawing) throw new TypeError("PNG fixture canvas required");
      drawing.fillStyle = "#e27631"; drawing.fillRect(0, 0, 64, 64);
      drawing.fillStyle = "#253858"; drawing.fillRect(16, 16, 32, 32);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    if (!data) throw new TypeError("PNG bytes required");
    const png = Buffer.from(data, "base64");
    const me = await owner.context.request.get("/api/me");
    const version = parseResourceVersionTag(me.headers()["etag"] ?? null);
    if (version === null) throw new TypeError("Account version required");
    const uploaded = await owner.context.request.put("/api/me/avatar", {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "if-match": resourceVersionTag(version) },
      multipart: { expectedVersion: String(version), file: { name: "avatar.png", mimeType: "image/png", buffer: png } },
    });
    expect(uploaded.status()).toBe(200);
    const avatarResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/me/avatar");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await avatarResponse).status()).toBe(200);
    const photo = account.locator("img.p-account-avatar");
    await photo.waitFor();
    expect(await photo.evaluate(async element => {
      if (!(element instanceof HTMLImageElement)) return false;
      if (!element.complete) await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new TypeError("Avatar decode timed out")), 10_000);
        element.addEventListener("load", () => { clearTimeout(timeout); resolve(); }, { once: true });
        element.addEventListener("error", () => { clearTimeout(timeout); reject(new TypeError("Avatar decode failed")); }, { once: true });
      });
      return element.naturalWidth === 64 && element.naturalHeight === 64;
    })).toBe(true);
    expect(await otherAccount.locator("img").count()).toBe(0);
    expect((await colleague.context.request.get("/api/me/avatar")).status()).toBe(404);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await account.evaluate(element => {
          const box = element.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth;
        })).toBe(true);
        await page.screenshot({ path: `${evidence}/${width}-${colorScheme}.png` });
      }
    }
    await account.click();
    await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
    expect(new URL(page.url()).pathname).toBe("/settings/profile");
    await page.close(); await other.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("DASHBOARD_AVATAR_CLOSED", { root, evidence });
}, 180_000);
