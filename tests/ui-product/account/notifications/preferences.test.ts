import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { fixtureIds as ids } from "../../../fixtures/foundation";

test("notification settings preserve enabled defaults and expose governed event opt-outs", async () => {
  const evidence = `docs/evidence/p12-notification-preferences/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    // Given real saved exceptions alongside events whose server default is enabled.
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("NOTIFICATION_UI_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const preferencesPath = endpoints.notificationPreferencesGet.path;
    const seeded = await owner.context.request.patch(preferencesPath, {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: {
        events: { share: false, custom_saved_event: true }, channels: ["in-app", "email"],
        projectOverrides: { [ids.project]: { custom_override: true } }, expectedVersion: 0,
      },
    });
    expect(seeded.status()).toBe(200);
    for (const width of [1440, 390]) {
      await using actor = await authenticatedContext(browser, app, {
        viewport: { width, height: width === 390 ? 844 : 900 },
        isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
      });
      const capture = await actor.context.newPage();
      for (const colorScheme of ["light", "dark"] as const) {
        await capture.emulateMedia({ colorScheme });
        await capture.goto("/settings/notifications", { waitUntil: "domcontentloaded" });
        await capture.getByRole("checkbox", { name: "Someone mentions me", exact: true }).waitFor();
        await capture.evaluate(() => document.fonts.ready);
        expect(await capture.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await capture.screenshot({ path: `${evidence}/settings-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    const page = await owner.context.newPage();
    await page.goto("/settings/notifications", { waitUntil: "domcontentloaded" });
    const mentions = page.getByRole("checkbox", { name: "Someone mentions me", exact: true });
    await mentions.waitFor();
    expect(await mentions.isChecked()).toBe(true);
    expect(await page.getByRole("checkbox", { name: "A project is shared with me", exact: true }).isChecked()).toBe(false);
    const accessRequests = page.getByRole("checkbox", { name: "Someone requests access to my project", exact: true });
    const organizationAi = page.getByRole("checkbox", { name: "My organization changes its AI policy", exact: true });
    expect(await accessRequests.isChecked()).toBe(true);
    expect(await organizationAi.isChecked()).toBe(true);
    // When an unchanged form is saved, defaults must not silently become opt-outs.
    const saved = page.waitForResponse(response => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === preferencesPath);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await waitForRenderedText(page, "Notification preferences saved.");
    const persisted = editorValue(resultSchema(endpoints.notificationPreferencesGet.output)
      .parse(await (await owner.context.request.get(preferencesPath)).json()));
    expect(persisted.events).toMatchObject({
      mention: true, share: false, custom_saved_event: true,
      "project.access.requested": true, "organization.ai.changed": true,
    });
    expect(persisted.projectOverrides).toEqual({ [ids.project]: { custom_override: true } });
    // When the user explicitly opts out, those choices persist across reload.
    await accessRequests.uncheck();
    await organizationAi.uncheck();
    const optedOut = page.waitForResponse(response => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === preferencesPath);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await optedOut).status()).toBe(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    await mentions.waitFor();
    expect(await mentions.isChecked()).toBe(true);
    expect(await accessRequests.isChecked()).toBe(false);
    expect(await organizationAi.isChecked()).toBe(false);
    expect(await page.getByRole("checkbox", { name: "custom_saved_event", exact: true }).isChecked()).toBe(true);
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("NOTIFICATION_UI_CLOSED", { root, evidence });
}, 180_000);
