import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { fixtureIds as ids } from "../../../fixtures/foundation";

test("organization settings create, resend and revoke pending invitations without admitting recipients", async () => {
  const evidence = `docs/evidence/p14-organization-invitations/sender-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("ORGANIZATION_SENDER_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const page = await owner.context.newPage();
    await page.goto(`${app.url.origin}/settings/organizations`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Robotics Lab/ }).click();
    const form = page.getByRole("form", { name: "Invite organization member", exact: true });
    await form.getByLabel("Invitation email", { exact: true }).fill("outsider@quire.local");
    await form.getByRole("combobox", { name: "Invitation role", exact: true }).selectOption("manager");
    const created = page.waitForResponse(response => response.url().endsWith(`/api/organizations/${ids.team}/invitations`) && response.request().method() === "POST");
    await form.getByRole("button", { name: "Send invitation", exact: true }).click();
    const creation = await created;
    expect(creation.status()).toBe(200);
    const invitation = editorValue(resultSchema(endpoints.organizationInvitationCreate.output).parse(await creation.json()));
    await waitForRenderedText(page, "Organization invitation queued.");
    expect(await app.application.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.team, ids.outsider])).toBeNull();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/sender-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    const resent = page.waitForResponse(response => response.url().endsWith(`/invitations/${invitation.id}/resend`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Resend invitation", exact: true }).click();
    expect((await resent).status()).toBe(200);
    await waitForRenderedText(page, "Organization invitation resent.");
    expect(await app.application.runtime.db.get("SELECT version FROM invitations WHERE id=?", [invitation.id])).toMatchObject({ version: 1 });
    const revoked = page.waitForResponse(response => response.url().endsWith(`/invitations/${invitation.id}`) && response.request().method() === "DELETE");
    await page.getByRole("button", { name: "Revoke invitation", exact: true }).click();
    expect((await revoked).status()).toBe(200);
    await waitForRenderedText(page, "No pending invitations.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Robotics Lab/ }).click();
    await waitForRenderedText(page, "No pending invitations.");
    expect(await app.application.runtime.db.get("SELECT status,version FROM invitations WHERE id=?", [invitation.id])).toMatchObject({ status: "revoked", version: 2 });
    expect(await app.application.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.team, ids.outsider])).toBeNull();
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("ORGANIZATION_SENDER_CLOSED", { root, evidence });
}, 180_000);
