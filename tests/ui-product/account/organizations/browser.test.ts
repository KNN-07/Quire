import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { unzipSync } from "fflate";
import { endpoints, resultSchema } from "@quire/contracts";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import type { Page } from "@playwright/test";

test("native organization settings admit existing accounts, enforce roles, edit policy and consume reports", async () => {
  const evidence = `docs/evidence/p13-organizations/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("ORGANIZATIONS_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const headers = { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "idempotency-key": crypto.randomUUID() };
    const page = await owner.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/settings/profile", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Organizations", exact: true }).click();
    await page.getByText("Create an organization", { exact: true }).click();
    await page.getByLabel("Organization name", { exact: true }).fill("Native governance laboratory");
    await submit(page, "POST", "/api/organizations", () => page.getByRole("button", { name: "Create organization", exact: true }).click(), 200);
    await page.getByText("Organization membership: admin", { exact: true }).waitFor();
    const listing = editorValue(resultSchema(endpoints.organizationsList.output).parse(await (await owner.context.request.get("/api/organizations?limit=200")).json()));
    const organization = listing.items.find(org => org.name === "Native governance laboratory");
    expect(organization).toBeDefined();
    if (!organization) throw new Error("Created organization missing from native list");
    const path = `/api/organizations/${organization.id}`;
    await page.getByText("Add an existing account", { exact: true }).click();
    await page.getByLabel("Verified account email", { exact: true }).fill("unknown@quire.local");
    await submit(page, "POST", `${path}/members`, () => page.getByRole("button", { name: "Add account", exact: true }).click(), 409);
    await waitForRenderedText(page, "An active verified account is required");
    await page.getByLabel("Verified account email", { exact: true }).fill("mai@quire.local");
    await page.getByRole("combobox", { name: "New member role", exact: true }).selectOption("manager");
    await submit(page, "POST", `${path}/members`, () => page.getByRole("button", { name: "Add account", exact: true }).click(), 200);
    await waitForRenderedText(page, "Existing account added.");
    await page.getByLabel("Verified account email", { exact: true }).fill("sam@quire.local");
    await page.getByRole("combobox", { name: "New member role", exact: true }).selectOption("member");
    await submit(page, "POST", `${path}/members`, () => page.getByRole("button", { name: "Add account", exact: true }).click(), 200);
    const sam = page.getByRole("form", { name: `Member ${ids.sam}`, exact: true });
    await sam.getByRole("checkbox", { name: "Licensed seat", exact: true }).waitFor();
    await sam.getByRole("checkbox", { name: "Licensed seat", exact: true }).check();
    const members = editorValue(resultSchema(endpoints.membersList.output).parse(await (await owner.context.request.get(`${path}/members?limit=200`)).json())).items;
    const samMember = members.find(member => member.userId === ids.sam);
    if (!samMember) throw new Error("Added member missing");
    await submit(page, "PATCH", `${path}/members/${samMember.id}`, () => sam.getByRole("button", { name: "Save member", exact: true }).click(), 200);
    await waitForRenderedText(page, "Membership saved.");
    const csv = await owner.context.request.get(`${path}/members.csv`);
    expect(csv.status()).toBe(200); expect(await csv.text()).toContain(ids.sam);
    await page.getByRole("combobox", { name: "AI mode", exact: true }).selectOption("ask");
    await submit(page, "PATCH", `${path}/policy`, () => page.getByRole("button", { name: "Save organization policy", exact: true }).click(), 200);
    await waitForRenderedText(page, "Organization policy saved.");
    const stored = editorValue(resultSchema(endpoints.organizationGet.output).parse(await (await owner.context.request.get(path)).json()));
    expect(stored.policy.ai).toBe("ask");
    // A concurrent native write makes the displayed policy version stale; never silently overwrite it.
    expect((await owner.context.request.patch(`${path}/policy`, { headers, data: { ai: "agent", expectedVersion: stored.version } })).status()).toBe(200);
    await submit(page, "PATCH", `${path}/policy`, () => page.getByRole("button", { name: "Save organization policy", exact: true }).click(), 409);
    await waitForRenderedText(page, "Resource changed; refresh and retry");
    await page.getByRole("button", { name: "Refresh organization", exact: true }).click();
    await waitForRenderedText(page, `version ${stored.version + 1}`);
    expect(await page.getByRole("combobox", { name: "AI mode", exact: true }).inputValue()).toBe("agent");
    await submit(page, "GET", `${path}/metrics`, () => page.getByRole("button", { name: "Load metrics", exact: true }).click(), 200);
    await waitForRenderedText(page, "Storage created (bytes)");
    await submit(page, "GET", `${path}/audit`, () => page.getByRole("button", { name: "Load audit history", exact: true }).click(), 200);
    await waitForRenderedText(page, "organization.created");
    await submit(page, "POST", `${path}/audit/export`, () => page.getByRole("button", { name: "Export audit ZIP", exact: true }).click(), 202);
    const downloaded = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download audit ZIP", exact: true }).click();
    const download = await downloaded;
    const file = await download.path();
    if (!file) throw new Error("Audit ZIP download missing");
    expect(download.suggestedFilename()).toBe("audit.zip");
    const files = unzipSync(new Uint8Array(await Bun.file(file).arrayBuffer()));
    expect(new TextDecoder().decode(files["audit-0001.csv"])).toContain("member.created");
    // Capture the actual organization detail, not a mock or design reproduction.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/organizations-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    // Ordinary members can read policy, not the directory or administrative actions.
    await using member = await authenticatedContext(browser, app, { email: "sam@quire.local" });
    const memberPage = await member.context.newPage();
    await openOrganization(memberPage, organization.name);
    await memberPage.getByText("Organization membership: member", { exact: true }).waitFor();
    expect(await memberPage.getByRole("button", { name: "Save organization policy", exact: true }).count()).toBe(0);
    expect(await memberPage.getByRole("button", { name: "Add account", exact: true }).count()).toBe(0);
    expect(await memberPage.getByRole("combobox", { name: "AI mode", exact: true }).isDisabled()).toBe(true);
    // Managers can license ordinary members but cannot edit policy or privileged memberships.
    await using manager = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    const managerPage = await manager.context.newPage();
    await openOrganization(managerPage, organization.name);
    await managerPage.getByText("Organization membership: manager", { exact: true }).waitFor();
    expect(await managerPage.getByRole("button", { name: "Save organization policy", exact: true }).count()).toBe(0);
    expect(await managerPage.getByRole("form", { name: `Member ${ids.kien}`, exact: true }).getByRole("button").count()).toBe(0);
    await managerPage.getByRole("form", { name: `Member ${ids.sam}`, exact: true }).getByRole("checkbox").uncheck();
    await submit(managerPage, "PATCH", `${path}/members/${samMember.id}`, () => managerPage.getByRole("form", { name: `Member ${ids.sam}`, exact: true }).getByRole("button", { name: "Save member", exact: true }).click(), 200);
    // Operators remain explicitly labelled, even without membership.
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    const operatorPage = await operator.context.newPage();
    await openOrganization(operatorPage, organization.name);
    await operatorPage.getByText("Organization membership: None", { exact: true }).waitFor();
    await operatorPage.getByText("Installation operator: Yes", { exact: true }).waitFor();
    expect(await operatorPage.getByRole("button", { name: "Save organization policy", exact: true }).isEnabled()).toBe(true);
    // A revoked administrator sees the native denial rather than a successful local update.
    const revocation = await operator.context.request.delete(`${path}/members/${members.find(record => record.userId === ids.kien)?.id ?? ""}`, {
      headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken }, data: { expectedVersion: 0 },
    });
    // The sole administrator is protected even against an operator.
    expect(revocation.status()).toBe(409);
    await submit(page, "DELETE", `${path}/members/${members.find(record => record.userId === ids.kien)?.id ?? ""}`, () => page.getByRole("form", { name: `Member ${ids.kien}`, exact: true }).getByRole("button", { name: "Remove member", exact: true }).click(), 409);
    await waitForRenderedText(page, "Keep at least one organization administrator");
    // Keep the existing settings navigation usable after adding the tab.
    await page.getByRole("link", { name: "Notifications", exact: true }).click();
    await page.getByRole("checkbox", { name: "Someone mentions me", exact: true }).waitFor();
    await page.getByRole("link", { name: "Profile", exact: true }).click();
    await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
    expect(errors).toEqual([]);
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("ORGANIZATIONS_CLOSED", { root, evidence });
}, 180_000);

async function openOrganization(page: Page, name: string) {
  await page.goto("/settings/organizations", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: new RegExp(name) }).click();
}
async function submit(page: Page, method: string, path: string, trigger: () => Promise<unknown>, status: number) {
  const response = page.waitForResponse(entry => entry.request().method() === method && new URL(entry.url()).pathname === path);
  await trigger(); expect((await response).status()).toBe(status);
}
