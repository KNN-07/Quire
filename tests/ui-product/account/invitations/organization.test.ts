import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { fixtureIds as ids } from "../../../fixtures/foundation";

test("an emailed organization invitation requires sign-in and explicit acceptance without assigning a license", async () => {
  const evidence = `docs/evidence/p14-organization-invitations/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("ORGANIZATION_INVITATION_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const organization = editorValue(resultSchema(endpoints.organizationGet.output).parse(
      await (await owner.context.request.get(`/api/organizations/${ids.team}`)).json()));
    const invitation = editorValue(resultSchema(endpoints.organizationInvitationCreate.output).parse(
      await (await owner.context.request.post(`/api/organizations/${ids.team}/invitations`, {
        headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "idempotency-key": crypto.randomUUID() },
        data: { email: "outsider@quire.local", role: "manager", expectedVersion: organization.version },
      })).json()));
    const mail = z.object({ body: z.string() }).parse(await app.application.runtime.db.get(
      "SELECT body FROM mail_outbox WHERE dedupe_key=?", [`organization-invite:${invitation.id}:0`]));
    const invitationUrl = new URL(mail.body);
    expect(invitationUrl.origin).toBe(app.url.origin);
    expect(invitationUrl.pathname).toBe(`/organization-invitations/${invitation.id}`);
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      const page = await context.newPage();
      await page.goto(invitationUrl.href, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign in to continue", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).fill("outsider@quire.local");
      await page.getByLabel("Password", { exact: true }).fill(app.password);
      const returned = page.waitForURL(url => url.pathname === invitationUrl.pathname);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await returned;
      await page.getByRole("button", { name: "Accept invitation", exact: true }).waitFor();
      expect((await context.request.get(`/api/organizations/${ids.team}`)).status()).toBe(403);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme });
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `${evidence}/pending-${width}-${colorScheme}.png`, fullPage: true });
        }
      }
      const accepted = page.waitForResponse(response => response.url().endsWith(`/api/organization-invitations/${invitation.id}/accept`) && response.request().method() === "POST");
      await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
      expect((await accepted).status()).toBe(200);
      await page.getByRole("button", { name: "Open organizations", exact: true }).waitFor();
      expect(await app.application.runtime.db.get("SELECT role,licensed FROM members WHERE organization_id=? AND user_id=?", [ids.team, ids.outsider])).toMatchObject({ role: "manager", licensed: 0 });
      expect((await context.request.get(`/api/organizations/${ids.team}`)).status()).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "This invitation is accepted.");
      expect(await page.getByRole("button", { name: "Accept invitation", exact: true }).count()).toBe(0);
    } finally { await context.close(); }
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("ORGANIZATION_INVITATION_CLOSED", { root, evidence });
}, 180_000);
