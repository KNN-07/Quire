import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { endpoints, resultSchema } from "@quire/contracts";
import { recordBillingTransition } from "../../../../services/accounts/governance";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser } from "../../../ui-editor/shared/browser";

test("native account deletion preserves organization administration, projects and active organization billing", async () => {
  const evidence = `docs/evidence/p57-self-deletion/browser-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  await using app = await connectionApplication();
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app);
  await using successor = await authenticatedContext(browser, app, { email: "mai@quire.local" });
  const page = await owner.context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const headers = { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken };
  const runtime = app.application.runtime;
  // Given: a last organization admin, an owned project and separately retained deleted content.
  expect((await owner.context.request.get(`/api/organizations/${ids.team}/billing`)).status()).toBe(200);
  await runtime.uow.run(tx => recordBillingTransition({ ...runtime, db: tx, routes: runtime.routes.forLane("A") }, {
    actorId: null, organizationId: ids.team, expectedVersion: 0, provider: "manual",
    planId: "owned-fixture-plan", period: "month", seats: 2, status: "active", renewsAt: null,
  }));
  const billing = await runtime.db.get("SELECT * FROM billing_accounts WHERE organization_id=?", [ids.team]);
  const created = await owner.context.request.post("/api/projects", {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { name: "Already deleted content", origin: { kind: "blank" } },
  });
  const deletedProject = editorValue(resultSchema(endpoints.projectCreate.output).parse(await created.json()));
  expect((await owner.context.request.delete(`/api/projects/${deletedProject.id}`, {
    headers, data: { confirmation: deletedProject.name, expectedVersion: deletedProject.version },
  })).status()).toBe(200);
  const originalFiles = await runtime.db.all(`SELECT f.* FROM files f JOIN branch_workspaces b ON b.id=f.branch_id
    WHERE b.project_id=? ORDER BY f.id`, [ids.project]);
  await page.goto(`${app.url.origin}/settings/security`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Delete account/ }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account", exact: true });
  await dialog.getByLabel("Confirmation email", { exact: true }).fill("kien@quire.local");
  await dialog.getByLabel("Current password", { exact: true }).fill(app.password);
  const denial = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/me" && response.request().method() === "DELETE");
  await dialog.getByRole("button", { name: "Permanently delete account", exact: true }).click();
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await (await denial).json()).error.code).toBe("LAST_ADMIN");
  await dialog.getByRole("alert").waitFor();
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.screenshot({ path: `${evidence}/last-admin-${width}-${colorScheme}.png` });
  }
  expect(await runtime.db.get("SELECT * FROM billing_accounts WHERE organization_id=?", [ids.team])).toEqual(billing);

  // When: ownership and organization administration are explicitly transferred before native self-deletion.
  expect((await owner.context.request.post(`/api/organizations/${ids.team}/members`, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { userId: ids.mai, role: "admin", licensed: false, expectedVersion: 0 },
  })).status()).toBe(200);
  const projectResponse = await owner.context.request.get(`/api/projects/${ids.project}`, { params: { branch: "main" } });
  const project = editorValue(resultSchema(endpoints.projectGet.output).parse(await projectResponse.json()));
  expect((await owner.context.request.post(`/api/projects/${ids.project}/transfer`, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { newOwnerId: ids.mai, expectedVersion: project.version },
  })).status()).toBe(200);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Delete account/ }).click();
  await dialog.getByLabel("Confirmation email", { exact: true }).fill("kien@quire.local");
  await dialog.getByLabel("Current password", { exact: true }).fill(app.password);
  const removed = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/me" && response.request().method() === "DELETE");
  await dialog.getByRole("button", { name: "Permanently delete account", exact: true }).click();
  expect((await removed).status()).toBe(200);
  await page.waitForURL("**/sign-in");

  // Then: the old account is revoked, the successor retains source/admin/billing, and deleted content stays deleted.
  expect((await owner.context.request.get("/api/me")).status()).toBe(401);
  expect((await successor.context.request.get(`/api/organizations/${ids.team}/billing`)).status()).toBe(200);
  expect(await runtime.db.get("SELECT * FROM billing_accounts WHERE organization_id=?", [ids.team])).toEqual(billing);
  expect(await runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [ids.project])).toEqual({ owner_id: ids.mai });
  expect(await runtime.db.all(`SELECT f.* FROM files f JOIN branch_workspaces b ON b.id=f.branch_id
    WHERE b.project_id=? ORDER BY f.id`, [ids.project])).toEqual(originalFiles);
  expect(await runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [deletedProject.id]))
    .toMatchObject({ owner_id: ids.kien, deleted_at: expect.any(String) });
  expect(errors).toEqual([]);
  console.info("P57_NATIVE_VERIFIED", JSON.stringify({
    evidence, root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin,
    deletedUser: ids.kien, successor: ids.mai, retainedProject: ids.project, deletedProject: deletedProject.id,
  }));
}, 180000);
