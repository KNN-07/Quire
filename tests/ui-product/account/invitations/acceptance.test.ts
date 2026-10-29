import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { fixtureIds as ids } from "../../../fixtures/foundation";

test("an emailed resent invitation survives sign-in and requires explicit recipient acceptance", async () => {
  const evidence = `docs/evidence/p13-invitations/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    // Given the real latest invitation email, with a nonzero version after resend.
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("INVITATION_UI_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const project = editorValue(resultSchema(endpoints.projectGet.output).parse(
      await (await owner.context.request.get(`/api/projects/${ids.project}?branch=main`)).json()));
    const headers = { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken };
    const invitation = editorValue(resultSchema(endpoints.invitationCreate.output).parse(await (await owner.context.request.post(
      `/api/projects/${ids.project}/invitations`, {
        headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        data: { email: "outsider@quire.local", role: "reviewer", expectedVersion: project.version },
      })).json()));
    const resent = await owner.context.request.post(`/api/projects/${ids.project}/invitations/${invitation.id}/resend`, {
      headers, data: { expectedVersion: invitation.version },
    });
    expect(resent.status()).toBe(200);
    const mail = z.object({ body: z.string() }).parse(await app.application.runtime.db.get(
      "SELECT body FROM mail_outbox WHERE dedupe_key=?", [`base-invite:${invitation.id}:1`]));
    const invitationUrl = new URL(mail.body);
    expect(invitationUrl.origin).toBe(app.url.origin);
    expect(invitationUrl.pathname).toBe(`/invitations/${invitation.id}`);
    expect(invitationUrl.searchParams.get("token")?.length).toBeGreaterThan(20);
    async function capture(state: "signed-out" | "pending" | "wrong-account" | "accepted") {
      for (const width of [1440, 390]) {
        const options = { baseURL: app.url.origin, viewport: { width, height: width === 390 ? 844 : 900 },
          isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1 };
        const actor = state === "signed-out" ? null : await authenticatedContext(browser, app, {
          ...options, email: state === "wrong-account" ? "alex@quire.local" : "outsider@quire.local",
        });
        const context = actor?.context ?? await browser.browser.newContext(options);
        try {
          const page = await context.newPage();
          for (const colorScheme of ["light", "dark"] as const) {
            await page.emulateMedia({ colorScheme });
            await page.goto(invitationUrl.href, { waitUntil: "domcontentloaded" });
            if (state === "signed-out") await page.getByRole("button", { name: "Sign in to continue", exact: true }).waitFor();
            else if (state === "pending") await page.getByRole("button", { name: "Accept invitation", exact: true }).waitFor();
            else if (state === "wrong-account") await page.getByRole("alert").waitFor();
            else await waitForRenderedText(page, "This invitation is accepted.");
            await page.evaluate(() => document.fonts.ready);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: `${evidence}/${state}-${width}-${colorScheme}.png`, fullPage: true });
          }
        } finally { await context.close(); }
      }
    }
    await capture("signed-out");
    await capture("pending");
    await capture("wrong-account");
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      const page = await context.newPage();
      // When the signed-out recipient follows the actual email, signs in, then accepts.
      await page.goto(invitationUrl.href, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign in to continue", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).fill("outsider@quire.local");
      await page.getByLabel("Password", { exact: true }).fill(app.password);
      const returned = page.waitForURL(url => url.pathname === invitationUrl.pathname);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await returned;
      await page.getByRole("button", { name: "Accept invitation", exact: true }).waitFor();
      expect(new URL(page.url()).searchParams.get("token")).toBe(invitationUrl.searchParams.get("token"));
      expect((await context.request.get(`/api/projects/${ids.project}?branch=main`)).status()).toBe(404);
      const accepted = page.waitForResponse(response => response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/invitations/${invitation.id}/accept`);
      await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
      const response = await accepted;
      expect(response.status()).toBe(200);
      // The real service rejects any counter other than 1 and returns its committed successor.
      expect(editorValue(resultSchema(endpoints.invitationAccept.output).parse(await response.json())).version).toBe(2);
      await page.getByRole("button", { name: "Open project", exact: true }).waitFor();
      // Then exact membership changes only after acceptance, and reload retains it.
      expect(await app.application.runtime.db.get("SELECT role FROM project_members WHERE project_id=? AND user_id=?",
        [ids.project, ids.outsider])).toEqual({ role: "reviewer" });
      expect((await context.request.get(`/api/projects/${ids.project}?branch=main`)).status()).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "This invitation is accepted.");
      expect(await page.getByRole("button", { name: "Accept invitation", exact: true }).count()).toBe(0);
    } finally { await context.close(); }
    await capture("accepted");
    // An untrusted return target must never send credentials/session navigation off-origin.
    const externalReturn = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      const page = await externalReturn.newPage();
      await page.goto("/sign-in?returnTo=https%3A%2F%2Fexample.invalid%2F", { waitUntil: "domcontentloaded" });
      await page.getByLabel("Email", { exact: true }).fill("outsider@quire.local");
      await page.getByLabel("Password", { exact: true }).fill(app.password);
      const returned = page.waitForURL(url => url.origin === app.url.origin && url.pathname === "/projects");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await returned;
      expect(new URL(page.url()).origin).toBe(app.url.origin);
    } finally { await externalReturn.close(); }
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("INVITATION_UI_CLOSED", { root, evidence });
}, 240_000);
