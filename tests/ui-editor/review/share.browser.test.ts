import { expect, test } from "bun:test";
import { defaultPolicy, fixtureIds as ids } from "../../fixtures/foundation";
import {
  authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText,
} from "../shared";
import { openPanel } from "./browser-harness";

test("shares with live owner updates and persists invitations and link revocation", async () => {
  // Given: two independently authenticated owner browser sessions subscribed before mutations.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await app.application.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
    VALUES(?,'project',?,?,?)`, [
    crypto.randomUUID(), ids.project,
    JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true }),
    app.application.runtime.clock.now(),
  ]);
  await app.application.runtime.db.run("UPDATE organizations SET policy_json=?", [
    JSON.stringify({ ...defaultPolicy, sharing: "anyone", anonymousRead: true }),
  ]);
  await using first = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
  await using second = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
  const page = await first.context.newPage();
  const observer = await second.context.newPage();
  await Promise.all([openPanel(page, { view: "share" }), openPanel(observer, { view: "share" })]);
  console.info("P2U_REVIEW_SHARE_STAGE", "panels-ready");
  // When: one owner sends a named Reviewer invitation.
  await page.getByLabel("Email to invite").fill("new-reviewer@example.edu");
  await page.getByLabel("Role").first().selectOption("reviewer");
  const invited = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/invitations`
    && response.request().method() === "POST", { timeout: 30_000 });
  await page.getByRole("button", { name: "Invite" }).click();
  expect((await invited).status()).toBe(200);
  // Then: the second subscribed session receives the real access event and renders it.
  await waitForRenderedText(observer, "new-reviewer@example.edu");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(page, "new-reviewer@example.edu");
  console.info("P2U_REVIEW_SHARE_STAGE", "invitation-persisted");
  // When: the owner changes a named collaborator role.
  const roleChanged = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/members/${ids.mai}`
    && response.request().method() === "PATCH", { timeout: 30_000 });
  await page.locator(".quire-share__person").filter({ hasText: "Mai Tran" }).locator("select").selectOption("reviewer");
  expect((await roleChanged).status()).toBe(200);
  await observer.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(observer, "Review fixture ready");
  expect(await observer.locator(".quire-share__person").filter({ hasText: "Mai Tran" })
    .locator("select").inputValue()).toBe("reviewer");
  console.info("P2U_REVIEW_SHARE_STAGE", "role-live");
  // When: link access is enabled, exercised anonymously and then revoked.
  const enabled = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/link`
    && response.request().method() === "PUT", { timeout: 30_000 });
  await page.getByRole("button", { name: "Anyone can view" }).click();
  expect((await enabled).status()).toBe(200);
  const token = new URL(await page.getByLabel("One-time share link").inputValue()).searchParams.get("share");
  if (!token) throw new TypeError("Expected one-time share token");
  const anonymous = await browser.browser.newContext({ baseURL: app.url.origin });
  try {
    expect((await anonymous.request.get(`/api/projects/${ids.project}/files`, {
      params: { branch: "main" }, headers: { "x-project-token": token },
    })).status()).toBe(200);
  } finally { await anonymous.close(); }
  console.info("P2U_REVIEW_SHARE_STAGE", "anonymous-read");
  const revoked = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/link`
    && response.request().method() === "PUT", { timeout: 30_000 });
  await page.getByRole("button", { name: "Off" }).click();
  expect((await revoked).status()).toBe(200);
  const revokedReader = await browser.browser.newContext({ baseURL: app.url.origin });
  try {
    expect((await revokedReader.request.get(`/api/projects/${ids.project}/files`, {
      params: { branch: "main" }, headers: { "x-project-token": token },
    })).status()).toBe(404);
  } finally { await revokedReader.close(); }
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(page, "Only named people can open this project.");
  console.info("P2U_REVIEW_SHARE_STAGE", "link-revoked");
  await using mobile = await authenticatedContext(browser, app, {
    viewport: { width: 390, height: 844 },
  });
  const mobilePage = await mobile.context.newPage();
  await openPanel(mobilePage, { view: "share", theme: "dark" });
  await page.screenshot({ path: "tests/ui-editor/review/evidence/share-1440-light.png", fullPage: true });
  await mobilePage.screenshot({ path: "tests/ui-editor/review/evidence/share-390-dark.png", fullPage: true });
  console.info("P2U_REVIEW_SHARE_STAGE", "screenshots-written");
  // When: pending invitation lifecycle and ownership transfer use their real endpoints.
  const invitationRow = page.locator(".quire-share__person").filter({ hasText: "new-reviewer@example.edu" });
  const resent = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/resend")
    && response.request().method() === "POST", { timeout: 30_000 });
  await invitationRow.getByRole("button", { name: "Resend" }).click();
  expect((await resent).status()).toBe(200);
  const currentInvitation = page.locator(".quire-share__person").filter({ hasText: "new-reviewer@example.edu" });
  const invitationRevoked = page.waitForResponse(response =>
    new URL(response.url()).pathname.includes("/invitations/")
    && response.request().method() === "DELETE", { timeout: 30_000 });
  await currentInvitation.getByRole("button", { name: "Revoke" }).click();
  expect((await invitationRevoked).status()).toBe(200);
  await page.locator(".quire-share__person").filter({ hasText: "Mai Tran" })
    .getByRole("button", { name: "Transfer ownership" }).click();
  const transferred = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/transfer`
    && response.request().method() === "POST", { timeout: 30_000 });
  await page.getByRole("button", { name: "Transfer ownership", exact: true }).last().click();
  expect((await transferred).status()).toBe(200);
}, 300_000);

test("accepts a live Viewer access request without granting authority before approval", async () => {
  // Given: independent owner and named Viewer sessions on the real share panel.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
  await using viewer = await authenticatedContext(browser, app, {
    email: "alex@quire.local", viewport: { width: 390, height: 844 },
  });
  const ownerPage = await owner.context.newPage();
  const requestPage = await viewer.context.newPage();
  await Promise.all([
    openPanel(ownerPage, { view: "share" }),
    openPanel(requestPage, { view: "share", theme: "dark", live: false }),
  ]);
  // When: the Viewer asks for Reviewer and the owner has not decided yet.
  await requestPage.getByLabel("Requested role").selectOption("reviewer");
  await requestPage.getByLabel("Message").fill("Please let me review this draft.");
  const requested = requestPage.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/projects/${ids.project}/access-requests`
    && response.request().method() === "POST", { timeout: 30_000 });
  await requestPage.getByRole("button", { name: "Send request" }).click();
  expect((await requested).status()).toBe(200);
  expect((await viewer.context.request.post(`/api/projects/${ids.project}/threads`, {
    headers: {
      origin: app.url.origin, "x-csrf-token": viewer.session.csrfToken,
      "idempotency-key": crypto.randomUUID(),
    },
    data: { scope: { projectId: ids.project, branch: "main" }, body: "Still Viewer", expectedVersion: 0 },
    timeout: 30_000,
  })).status()).toBe(403);
  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(ownerPage, "Please let me review this draft.");
  // When: the owner accepts the exact pending request.
  const requestRow = ownerPage.locator(".quire-share__request").filter({ hasText: "Please let me review this draft." });
  const accepted = ownerPage.waitForResponse(response =>
    new URL(response.url()).pathname.includes("/access-requests/")
    && response.request().method() === "POST", { timeout: 30_000 });
  await requestRow.getByRole("button", { name: "Accept" }).click();
  expect((await accepted).status()).toBe(200);
  await requestPage.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(requestPage, "current role is reviewer");
  console.info("P2U_REVIEW_SHARE_STAGE", "request-accepted");
}, 300_000);
