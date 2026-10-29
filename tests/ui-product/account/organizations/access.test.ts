import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../../fixtures/foundation";

test("authoritative organization access preserves operator authority across membership roles", async () => {
  const evidence = `docs/evidence/p13-organizations/access-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("ORGANIZATION_ACCESS_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const headers = { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "idempotency-key": crypto.randomUUID() };
    const created = await owner.context.request.post("/api/organizations", { headers, data: { name: "Operator access laboratory", kind: "team", domains: [] } });
    expect(created.status()).toBe(200);
    const organization = editorValue(resultSchema(endpoints.organizationCreate.output).parse(await created.json()));
    const path = `/api/organizations/${organization.id}`;
    const added = await owner.context.request.post(`${path}/members`, { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { userId: ids.operator, role: "member", licensed: false, expectedVersion: 0 } });
    expect(added.status()).toBe(200);
    let membership = editorValue(resultSchema(endpoints.memberCreate.output).parse(await added.json()));
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    const page = await operator.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const accessResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${path}/access`);
    await page.goto("/settings/organizations", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: new RegExp(organization.name) }).click();
    expect((await accessResponse).status()).toBe(200);
    await page.getByText("Organization membership: member", { exact: true }).waitFor();
    expect(await page.getByText("Installation operator: Yes", { exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Save organization policy", exact: true }).isEnabled()).toBe(true);
    const own = page.getByRole("form", { name: `Member ${ids.operator}`, exact: true });
    expect(await own.getByRole("combobox", { name: "Member role", exact: true }).locator("option").allTextContents()).toEqual(["Member", "Manager", "Administrator"]);
    // An operator with an ordinary membership can actually perform an admin policy write.
    await page.getByRole("combobox", { name: "AI mode", exact: true }).selectOption("ask");
    const policyResponse = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === `${path}/policy`);
    await page.getByRole("button", { name: "Save organization policy", exact: true }).click();
    expect((await policyResponse).status()).toBe(200);
    await waitForRenderedText(page, "Organization policy saved.");
    const promoted = await owner.context.request.patch(`${path}/members/${membership.id}`, { headers, data: { role: "manager", expectedVersion: membership.version } });
    expect(promoted.status()).toBe(200);
    membership = editorValue(resultSchema(endpoints.memberPatch.output).parse(await promoted.json()));
    await page.getByRole("button", { name: "Refresh organization", exact: true }).click();
    await page.getByText("Organization membership: manager", { exact: true }).waitFor();
    expect(await page.getByText("Installation operator: Yes", { exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Save organization policy", exact: true }).isEnabled()).toBe(true);
    // Membership is still separate from operator authority: a normal member has no directory probe.
    const current = editorValue(resultSchema(endpoints.organizationGet.output).parse(await (await owner.context.request.get(path)).json()));
    expect((await owner.context.request.post(`${path}/members`, { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { userId: ids.sam, role: "member", licensed: false, expectedVersion: current.version } })).status()).toBe(200);
    await using member = await authenticatedContext(browser, app, { email: "sam@quire.local" });
    const memberPage = await member.context.newPage();
    const directoryRequests: string[] = [];
    memberPage.on("request", request => { if (new URL(request.url()).pathname === `${path}/members`) directoryRequests.push(request.url()); });
    const memberAccess = memberPage.waitForResponse(response => new URL(response.url()).pathname === `${path}/access`);
    await memberPage.goto("/settings/organizations", { waitUntil: "domcontentloaded" });
    await memberPage.getByRole("button", { name: new RegExp(organization.name) }).click();
    const memberAccessResult = await memberAccess;
    expect(editorValue(resultSchema(endpoints.organizationAccess.output).parse(await memberAccessResult.json()))).toEqual({ role: "member", operator: false });
    await memberPage.getByText("Organization membership: member", { exact: true }).waitFor();
    expect(await memberPage.getByText("Installation operator: No", { exact: true }).isVisible()).toBe(true);
    expect(await memberPage.getByRole("button", { name: "Save organization policy", exact: true }).count()).toBe(0);
    expect(directoryRequests).toEqual([]);
    // Current captures prove the corrected two-axis access presentation at both widths and themes.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/access-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    expect(membership.role).toBe("manager");
    expect(errors).toEqual([]);
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("ORGANIZATION_ACCESS_CLOSED", { root, evidence });
}, 180_000);
