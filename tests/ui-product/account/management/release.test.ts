import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("administrator release removes team control while the user signs in independently and keeps owned projects", async () => {
  const evidence = `docs/evidence/p18-management-ui/release-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("MANAGEMENT_RELEASE_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using admin = await authenticatedContext(browser, app);
    await using user = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    const adminHeaders = { origin: app.url.origin, "x-csrf-token": admin.session.csrfToken };
    expect((await admin.context.request.post(`/api/organizations/${ids.team}/members`, {
      headers: { ...adminHeaders, "idempotency-key": crypto.randomUUID() },
      data: { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 },
    })).status()).toBe(200);
    expect((await admin.context.request.post(`/api/organizations/${ids.team}/managed/invite`, {
      headers: { ...adminHeaders, "idempotency-key": crypto.randomUUID() }, data: { userId: ids.mai, expectedVersion: 1 },
    })).status()).toBe(200);
    const own = editorValue(resultSchema(endpoints.managementList.output).parse(await (await user.context.request.get("/api/me/management")).json()));
    const invitation = own.items.find(item => item.organizationId === ids.team && item.canAccept);
    if (!invitation) throw new TypeError("Management invitation missing");
    const userHeaders = { origin: app.url.origin, "x-csrf-token": user.session.csrfToken };
    expect((await user.context.request.post(`/api/managed/${invitation.id}/accept`, {
      headers: { ...userHeaders, "idempotency-key": crypto.randomUUID() }, data: { expectedVersion: invitation.version },
    })).status()).toBe(200);
    const project = editorValue(resultSchema(endpoints.projectCreate.output).parse(await (await user.context.request.post("/api/projects", {
      headers: { ...userHeaders, "idempotency-key": crypto.randomUUID() },
      data: { name: "Independent retained project", origin: { kind: "blank" } },
    })).json()));
    const page = await admin.context.newPage();
    await page.goto(`${app.url.origin}/settings/organizations`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Robotics Lab/ }).click();
    await page.getByRole("group", { name: "Management for mai@quire.local", exact: true }).getByRole("button", { name: "Release account", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Release account", exact: true });
    await dialog.waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme }); await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/confirm-${width}-${colorScheme}.png` });
      }
    }
    await dialog.getByLabel("Confirmation email", { exact: true }).fill("mai@quire.local");
    const released = page.waitForResponse(response => response.url().endsWith(`/api/organizations/${ids.team}/managed/${ids.mai}/release`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Confirm release", exact: true }).click();
    expect((await released).status()).toBe(200);
    await waitForRenderedText(page, "Account released.");
    expect(await app.application.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.team, ids.mai])).toBeNull();
    expect(await app.application.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [project.id])).toMatchObject({ owner_id: ids.mai, deleted_at: null });
    expect((await user.context.request.get("/api/me")).status()).toBe(401);
    const independent = await user.context.newPage();
    await independent.goto(`${app.url.origin}/sign-in?returnTo=%2Fsettings%2Fsecurity`, { waitUntil: "domcontentloaded" });
    await independent.getByLabel("Email", { exact: true }).fill("mai@quire.local");
    await independent.getByLabel("Password", { exact: true }).fill(app.password);
    const signedIn = independent.waitForURL(url => url.pathname === "/settings/security");
    await independent.getByRole("button", { name: "Sign in", exact: true }).click();
    await signedIn;
    await waitForRenderedText(independent, "Management status: released");
    expect(await independent.getByRole("button", { name: /^Delete account/ }).isEnabled()).toBe(true);
    expect((await user.context.request.get(`/api/projects/${project.id}?branch=main`)).status()).toBe(200);
    expect((await user.context.request.get(`/api/organizations/${ids.team}`)).status()).toBe(403);
    await independent.close(); await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("MANAGEMENT_RELEASE_CLOSED", { root, evidence });
}, 240_000);
