import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { IdSchema, InstantSchema, ManagedLifecycleScheduleSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { connectionApplication } from "../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared/browser";

test("native organization settings persist explicit lifecycle authority, dates, disable and unauthorized denial", async () => {
  const evidence = `docs/evidence/p46-managed-lifecycle/browser-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  let web = "";
  let api = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir; web = app.url.origin; api = app.apiUrl.origin;
    expect(app.url.port).not.toBe("5173"); expect(app.apiUrl.port).not.toBe("5173");
    console.info("MANAGED_BROWSER_OWNED", { root, web, api, evidence });
    await using browser = await startEditorBrowser();
    await using admin = await authenticatedContext(browser, app);
    await using owner = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    const path = `/api/organizations/${ids.team}/managed-lifecycle`;
    const headers = { origin: web, "x-csrf-token": admin.session.csrfToken };
    expect((await admin.context.request.post(`/api/organizations/${ids.team}/members`, {
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      data: { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 },
    })).status()).toBe(200);
    for (const [userId, actor] of [[ids.mai, owner], [ids.kien, admin]] as const) {
      expect((await admin.context.request.post(`/api/organizations/${ids.team}/managed/invite`, {
        headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { userId, expectedVersion: 1 },
      })).status()).toBe(200);
      const row = z.object({ id: IdSchema }).parse(await app.application.runtime.db.get(
        "SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.team, userId]));
      expect((await actor.context.request.post(`/api/managed/${row.id}/accept`, {
        headers: { origin: web, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
        data: { expectedVersion: 0 },
      })).status()).toBe(200);
    }
    const page = await admin.context.newPage();
    const failures: string[] = [];
    page.on("pageerror", error => failures.push(error.message));
    await page.goto(`${web}/settings/organizations`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Robotics Lab/ }).click();
    const panel = page.getByRole("region", { name: "Automatic managed lifecycle", exact: true });
    await waitForRenderedText(page, "Schedule disabled.");
    const lifecycle = panel.getByRole("form", { name: "Lifecycle for mai@quire.local", exact: true });
    expect(await lifecycle.getByRole("button", { name: "Suspend and start lapse", exact: true }).isDisabled()).toBe(true);
    expect((await admin.context.request.post(`/api/organizations/${ids.team}/managed/${ids.mai}/lifecycle`, {
      headers, data: { action: "lapse", expectedVersion: 1 },
    })).status()).toBe(409);
    const form = panel.getByRole("form", { name: "Managed lifecycle schedule", exact: true });
    await form.getByRole("checkbox", { name: "Enable automatic managed lifecycle", exact: true }).check();
    await form.getByLabel("Soft deletion day from lapse", { exact: true }).fill("7");
    await form.getByLabel("Final deletion day from lapse", { exact: true }).fill("12");
    await form.getByRole("combobox", { name: "Scheduled project recipient", exact: true }).selectOption(ids.kien);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "PUT");
    await form.getByRole("button", { name: "Save lifecycle schedule", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await waitForRenderedText(page, "Lifecycle schedule saved.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Robotics Lab/ }).click();
    await waitForRenderedText(page, "Schedule enabled.");
    expect(await form.getByLabel("Soft deletion day from lapse", { exact: true }).inputValue()).toBe("7");
    expect(await form.getByLabel("Final deletion day from lapse", { exact: true }).inputValue()).toBe("12");
    expect(await form.getByRole("combobox", { name: "Scheduled project recipient", exact: true }).inputValue()).toBe(ids.kien);
    const readResponse = await admin.context.request.get(path);
    const persisted = z.object({ data: ManagedLifecycleScheduleSchema }).parse(await readResponse.json()).data;
    expect(persisted).toMatchObject({ version: 1, authorizedBy: ids.kien, authorityValid: true });
    for (const actor of [owner, operator]) {
      expect((await actor.context.request.put(path, { headers: { origin: web, "x-csrf-token": actor.session.csrfToken },
        data: { settings: persisted.settings, expectedVersion: 1 } })).status()).toBe(403);
    }
    expect((await owner.context.request.get(path)).status()).toBe(403);
    await lifecycle.getByRole("checkbox").check();
    const lapsed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/managed/${ids.mai}/lifecycle`)
      && response.request().method() === "POST");
    await lifecycle.getByRole("button", { name: "Suspend and start lapse", exact: true }).click();
    expect((await lapsed).status()).toBe(200);
    await waitForRenderedText(page, "Account suspended; lapse started.");
    const schedule = z.object({ data: ManagedLifecycleScheduleSchema }).parse(await (await admin.context.request.get(path)).json()).data;
    const account = schedule.accounts.find(entry => entry.userId === ids.mai);
    if (!account?.lapseAt || !account.nextAt) throw new Error("Visible next-stage dates required");
    expect(account.nextAt).toBe(InstantSchema.parse(new Date(Date.parse(account.lapseAt) + 7 * 86_400_000).toISOString()));
    await waitForRenderedText(page, account.nextAt);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme }); await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await panel.screenshot({ path: `${evidence}/schedule-${width}-${colorScheme}.png` });
      }
    }
    await form.getByRole("checkbox", { name: "Enable automatic managed lifecycle", exact: true }).uncheck();
    const disabled = page.waitForResponse(entry => new URL(entry.url()).pathname === path && entry.request().method() === "PUT");
    await form.getByRole("button", { name: "Save lifecycle schedule", exact: true }).click();
    expect((await disabled).status()).toBe(200);
    await waitForRenderedText(page, "Schedule disabled.");
    await waitForRenderedText(page, "Paused stage: Soft deletion");
    expect((await admin.context.request.get(path)).status()).toBe(200);
    const recovered = page.waitForResponse(entry => new URL(entry.url()).pathname.endsWith(`/managed/${ids.mai}/lifecycle`)
      && entry.request().method() === "POST");
    await lifecycle.getByRole("button", { name: "Recover account", exact: true }).click();
    expect((await recovered).status()).toBe(200);
    await waitForRenderedText(page, "Account recovered; lapse cleared.");
    expect(await lifecycle.getByRole("button", { name: "Suspend and start lapse", exact: true }).isDisabled()).toBe(true);
    expect(failures).toEqual([]);
    await page.close();
    const operatorPage = await operator.context.newPage();
    await operatorPage.goto(`${web}/settings/organizations`, { waitUntil: "domcontentloaded" });
    await operatorPage.getByRole("button", { name: /Robotics Lab/ }).click();
    await waitForRenderedText(operatorPage, "Installation operator status alone is not sufficient.");
    expect(await operatorPage.getByRole("button", { name: "Save lifecycle schedule", exact: true }).isDisabled()).toBe(true);
    await operatorPage.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  for (const origin of [web, api]) {
    await rejects(fetch(origin, { signal: AbortSignal.timeout(2000) }));
  }
  console.info("MANAGED_BROWSER_CLOSED", { root, web, api, evidence });
}, 240_000);
