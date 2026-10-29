import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("account settings require explicit consent before accepting real organization management", async () => {
  const evidence = `docs/evidence/p18-management-ui/acceptance-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("MANAGEMENT_ACCEPTANCE_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using admin = await authenticatedContext(browser, app);
    await using user = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    const headers = { origin: app.url.origin, "x-csrf-token": admin.session.csrfToken, "idempotency-key": crypto.randomUUID() };
    expect((await admin.context.request.post(`/api/organizations/${ids.team}/members`, {
      headers, data: { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 },
    })).status()).toBe(200);
    expect((await admin.context.request.post(`/api/organizations/${ids.team}/managed/invite`, {
      headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { userId: ids.mai, expectedVersion: 1 },
    })).status()).toBe(200);
    const page = await user.context.newPage();
    await page.goto(`${app.url.origin}/settings/security`, { waitUntil: "domcontentloaded" });
    const form = page.getByRole("form", { name: "Accept management by Robotics Lab", exact: true });
    await form.waitFor();
    expect(await form.evaluate(element => element instanceof HTMLFormElement && element.checkValidity())).toBe(false);
    expect(await app.application.runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.mai])).toMatchObject({ managed_by: null });
    for (const state of ["pending", "accepted"] as const) {
      if (state === "accepted") {
        await form.getByRole("checkbox").check();
        const accepted = page.waitForResponse(response => /\/api\/managed\/[^/]+\/accept$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
        await form.getByRole("button", { name: "Accept management", exact: true }).click();
        expect((await accepted).status()).toBe(200);
        await waitForRenderedText(page, "Account management accepted.");
        expect(await app.application.runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.mai])).toMatchObject({ managed_by: ids.team });
        expect(await page.getByRole("button", { name: /^Delete account/ }).isDisabled()).toBe(true);
        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForRenderedText(page, "Management status: accepted");
        expect(await page.getByRole("button", { name: "Accept management", exact: true }).count()).toBe(0);
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme }); await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `${evidence}/${state}-${width}-${colorScheme}.png`, fullPage: true });
        }
      }
    }
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("MANAGEMENT_ACCEPTANCE_CLOSED", { root, evidence });
}, 180_000);
