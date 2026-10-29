import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser } from "../../../ui-editor/shared/browser";
import { fixtureIds as ids } from "../../../fixtures/foundation";

test("institution controls preserve self-enrollment and the native portal enforces verified eligibility", async () => {
  const evidence = `docs/evidence/p15-institution-boundaries/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("INSTITUTION_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    await using user = await authenticatedContext(browser, app, { email: "outsider@quire.local" });
    const path = `/api/organizations/${ids.institution}`;
    const org = editorValue(resultSchema(endpoints.organizationGet.output).parse(await (await operator.context.request.get(path)).json()));
    const headers = { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken };
    expect((await operator.context.request.patch(path, { headers, data: { domains: ["eligible.example"], expectedVersion: org.version } })).status()).toBe(200);
    const settings = await operator.context.newPage();
    await settings.goto(`${app.url.origin}/settings/organizations`, { waitUntil: "domcontentloaded" });
    await settings.getByRole("button", { name: new RegExp(org.name) }).click();
    await settings.getByRole("link", { name: "Open institution enrollment", exact: true }).waitFor();
    expect(await settings.getByRole("form", { name: "Invite organization member", exact: true }).count()).toBe(0);
    expect(await settings.getByText("Add an existing account", { exact: true }).count()).toBe(0);
    for (const width of [1440, 390]) {
      await settings.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await settings.emulateMedia({ colorScheme }); await settings.evaluate(() => document.fonts.ready);
        expect(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await settings.screenshot({ path: `${evidence}/settings-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    const portal = await user.context.newPage();
    await portal.goto(`${app.url.origin}/institutions/${org.slug}`, { waitUntil: "domcontentloaded" });
    const denied = portal.waitForResponse(response => response.url().endsWith(`/api/institutions/${org.slug}/enroll`) && response.request().method() === "POST");
    await portal.getByRole("button", { name: "Join institution", exact: true }).click();
    expect((await denied).status()).toBe(403);
    await portal.getByRole("alert").waitFor();
    expect(await app.application.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.outsider])).toBeNull();
    expect((await operator.context.request.patch(path, { headers, data: { domains: ["quire.local"], expectedVersion: org.version + 1 } })).status()).toBe(200);
    await portal.reload({ waitUntil: "domcontentloaded" });
    const enrolled = portal.waitForResponse(response => response.url().endsWith(`/api/institutions/${org.slug}/enroll`) && response.request().method() === "POST");
    await portal.getByRole("button", { name: "Join institution", exact: true }).click();
    expect((await enrolled).status()).toBe(200);
    await portal.getByRole("link", { name: "Open your projects", exact: true }).waitFor();
    expect(await app.application.runtime.db.get("SELECT role,licensed FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.outsider])).toMatchObject({ role: "member", licensed: 0 });
    expect(await app.application.runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.outsider])).toMatchObject({ managed_by: null });
    for (const width of [1440, 390]) {
      await portal.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await portal.emulateMedia({ colorScheme }); await portal.evaluate(() => document.fonts.ready);
        expect(await portal.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await portal.screenshot({ path: `${evidence}/portal-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    await settings.close(); await portal.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("INSTITUTION_CLOSED", { root, evidence });
}, 180_000);
