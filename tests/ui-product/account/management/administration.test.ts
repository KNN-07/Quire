import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("organization administration waits for consent and offers only accepted managed transfer recipients", async () => {
  const evidence = `docs/evidence/p18-management-ui/administration-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("MANAGEMENT_ADMIN_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using admin = await authenticatedContext(browser, app);
    await using owner = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    await using recipient = await authenticatedContext(browser, app, { email: "sam@quire.local" });
    for (const [expectedVersion, userId] of [ids.mai, ids.sam].entries()) {
      expect((await admin.context.request.post(`/api/organizations/${ids.team}/members`, {
        headers: { origin: app.url.origin, "x-csrf-token": admin.session.csrfToken, "idempotency-key": crypto.randomUUID() },
        data: { userId, role: "member", licensed: false, expectedVersion },
      })).status()).toBe(200);
    }
    const project = editorValue(resultSchema(endpoints.projectCreate.output).parse(await (await owner.context.request.post("/api/projects", {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { name: "Managed transfer proof", origin: { kind: "blank" } },
    })).json()));
    const page = await admin.context.newPage();
    await page.goto(`${app.url.origin}/settings/organizations`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Robotics Lab/ }).click();
    for (const [email, actor, state] of [
      ["mai@quire.local", owner, "no-recipient"], ["sam@quire.local", recipient, "eligible-recipient"],
    ] as const) {
      const group = page.getByRole("group", { name: `Management for ${email}`, exact: true });
      const invited = page.waitForResponse(response => response.url().endsWith(`/api/organizations/${ids.team}/managed/invite`) && response.request().method() === "POST");
      await group.getByRole("button", { name: "Invite to management", exact: true }).click();
      expect((await invited).status()).toBe(200);
      await waitForRenderedText(page, "Management invitation queued.");
      expect(await app.application.runtime.db.get("SELECT managed_by FROM users WHERE primary_email=?", [email])).toMatchObject({ managed_by: null });
      const memberPage = await actor.context.newPage();
      await memberPage.goto(`${app.url.origin}/settings/security`, { waitUntil: "domcontentloaded" });
      const form = memberPage.getByRole("form", { name: "Accept management by Robotics Lab", exact: true });
      await form.getByRole("checkbox").check();
      const accepted = memberPage.waitForResponse(response => /\/api\/managed\/[^/]+\/accept$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
      await form.getByRole("button", { name: "Accept management", exact: true }).click();
      expect((await accepted).status()).toBe(200);
      await waitForRenderedText(memberPage, "Account management accepted.");
      await memberPage.close();
      await page.getByRole("button", { name: "Refresh managed accounts", exact: true }).click();
      const donor = page.getByRole("group", { name: "Management for mai@quire.local", exact: true });
      await donor.getByRole("button", { name: "Delete managed account", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete managed account", exact: true });
      await dialog.waitFor();
      if (state === "no-recipient") {
        expect(await dialog.getByRole("button", { name: "Delete and reassign", exact: true }).isDisabled()).toBe(true);
        expect(await dialog.getByRole("combobox").count()).toBe(0);
      } else {
        expect(await dialog.getByRole("combobox").locator("option").evaluateAll(options => options.map(option => option instanceof HTMLOptionElement ? option.value : ""))).toEqual(["", ids.sam]);
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme }); await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `${evidence}/${state}-${width}-${colorScheme}.png` });
        }
      }
      if (state === "no-recipient") await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      else {
        await dialog.getByRole("combobox", { name: "Transfer projects to", exact: true }).selectOption(ids.sam);
        await dialog.getByLabel("Confirmation email", { exact: true }).fill("mai@quire.local");
        const deleted = page.waitForResponse(response => response.url().endsWith(`/api/organizations/${ids.team}/managed/${ids.mai}/delete`) && response.request().method() === "POST");
        await dialog.getByRole("button", { name: "Delete and reassign", exact: true }).click();
        expect((await deleted).status()).toBe(200);
        await waitForRenderedText(page, "Managed account deleted and projects reassigned.");
      }
    }
    expect(await app.application.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [project.id])).toMatchObject({ owner_id: ids.sam, deleted_at: null });
    expect((await owner.context.request.get("/api/me")).status()).toBe(401);
    expect((await recipient.context.request.get(`/api/projects/${project.id}?branch=main`)).status()).toBe(200);
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("MANAGEMENT_ADMIN_CLOSED", { root, evidence });
}, 240_000);
