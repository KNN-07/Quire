import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser } from "../../../ui-editor/shared/browser";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import { reconcileInstitutionEligibility } from "../../../../services/accounts/governance/lifecycle";

test("institution settings configure a period and the native portal renews an expired membership", async () => {
  const evidence = `docs/evidence/p73-institution-reconfirmation/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("RECONFIRMATION_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    await using user = await authenticatedContext(browser, app, { email: "outsider@quire.local" });
    const path = `/api/organizations/${ids.institution}`;
    const org = editorValue(resultSchema(endpoints.organizationGet.output).parse(await (await operator.context.request.get(path)).json()));
    const headers = { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken };
    expect((await operator.context.request.patch(path, { headers, data: { domains: ["quire.local"], expectedVersion: org.version } })).status()).toBe(200);
    const settings = await operator.context.newPage();
    await settings.goto(`${app.url.origin}/settings/organizations`, { waitUntil: "domcontentloaded" });
    await settings.getByRole("button", { name: new RegExp(org.name) }).click();
    await settings.getByRole("spinbutton", { name: "Reconfirmation period in days" }).fill("7");
    const saved = settings.waitForResponse(response => response.url().endsWith("/institution-policy") && response.request().method() === "PUT");
    await settings.getByRole("button", { name: "Save reconfirmation policy", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await settings.getByText("Institution reconfirmation policy saved.", { exact: true }).waitFor();
    expect(await app.application.runtime.db.get("SELECT reconfirmation_days FROM institution_reconfirmation_policies WHERE organization_id=?", [ids.institution]))
      .toMatchObject({ reconfirmation_days: 7 });
    const portal = await user.context.newPage();
    await portal.goto(`${app.url.origin}/institutions/${org.slug}`, { waitUntil: "domcontentloaded" });
    await portal.getByRole("button", { name: "Join institution", exact: true }).click();
    await portal.getByText("Institution eligibility is current.", { exact: true }).waitFor();
    // Browser composition uses the real clock. Install an already-due receipt, then
    // run the real reconciler; exact configured clock boundaries are covered natively.
    await app.application.runtime.db.run("UPDATE institutional_eligibility SET expires_at=? WHERE organization_id=? AND user_id=?",
      ["2020-01-01T00:00:00.000Z", ids.institution, ids.outsider]);
    expect(await reconcileInstitutionEligibility({ ...app.application.runtime, routes: app.application.runtime.routes.forLane("A") })).toBe(1);
    await portal.reload({ waitUntil: "domcontentloaded" });
    await portal.getByText("Reconfirmation overdue.", { exact: false }).waitFor();
    for (const width of [1440, 390]) {
      await settings.setViewportSize({ width, height: 900 });
      await portal.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await settings.emulateMedia({ colorScheme }); await portal.emulateMedia({ colorScheme });
        await settings.evaluate(() => document.fonts.ready); await portal.evaluate(() => document.fonts.ready);
        expect(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await portal.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await settings.screenshot({ path: `${evidence}/settings-${width}-${colorScheme}.png`, fullPage: true });
        await portal.screenshot({ path: `${evidence}/expired-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    const renewed = portal.waitForResponse(response => response.url().endsWith("/enroll") && response.request().method() === "POST");
    await portal.getByRole("button", { name: "Reconfirm institution eligibility", exact: true }).click();
    expect((await renewed).status()).toBe(200);
    await portal.getByText("Institution eligibility is current.", { exact: true }).waitFor();
    const status = editorValue(resultSchema(endpoints.institutionEligibility.output).parse(
      await (await user.context.request.get(`/api/institutions/${org.slug}/eligibility`)).json()));
    expect(status).toMatchObject({ member: true, state: "current", reconfirmationDays: 7 });
    expect(Date.parse(status.expiresAt ?? "") - Date.parse(status.checkedAt ?? "")).toBe(7 * 86_400_000);
    expect(await app.application.runtime.db.get("SELECT managed_by,suspended FROM users WHERE id=?", [ids.outsider])).toMatchObject({ managed_by: null, suspended: 0 });
    await portal.screenshot({ path: `${evidence}/renewed-390-dark.png`, fullPage: true });
    await settings.close(); await portal.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("RECONFIRMATION_CLOSED", { root, evidence });
}, 180_000);
