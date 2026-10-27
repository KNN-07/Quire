import assert from "node:assert/strict";

export async function checkExportAndLogout(page, origin) {
  // Given: a fresh authenticated session in the security screen.
  await page.goto(origin + "/settings/security", { waitUntil: "commit" });
  // When: an account metadata export is requested from the real service.
  await page.getByRole("button", { name: "Request account export" }).click();
  await page.getByRole("button", { name: "Download account data" }).waitFor({ state: "visible", timeout: 10000 });
  const downloaded = page.waitForEvent("download", { timeout: 10000 });
  await page.getByRole("button", { name: "Download account data" }).click();
  const download = await downloaded;
  const path = await download.path();
  assert.ok(path);
  const data = await Bun.file(path).json();
  // Then: the downloaded JSON contains actual account metadata, not secrets.
  assert.equal(data.format, "quire-account-v1");
  assert.equal(data.user.primaryEmail, "kien@quire.local");
  assert.equal(Object.hasOwn(data.user, "password_hash"), false);

  // Given: the same real session.
  // When: the user signs out through the current-session control.
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  // Then: session refresh completes and the browser reaches sign-in.
  await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const me = await page.request.get(origin + "/api/me");
  assert.equal(me.status(), 401);
}

export async function checkResetSuccess(page, origin, mailbox) {
  // Given: a verified, browser-created account and the real reset request form.
  await page.goto(origin + "/reset-password", { waitUntil: "commit" });
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(mailbox.email);
  const requested = page.waitForResponse(response => response.url().endsWith("/api/auth/password-reset"));
  // When: the user requests a reset through the actual service.
  await page.getByRole("button", { name: "Send reset link" }).click();
  assert.equal((await requested).status(), 200);
  // Then: the operator-only local mailbox contains a real reset URL.
  const link = mailbox.read();
  assert.equal(link.pathname, "/reset-password");

  // Given: that one-time reset link and matching new passwords.
  await page.goto(origin + link.pathname + link.search, { waitUntil: "commit" });
  await page.getByLabel("New password", { exact: true }).fill("changed-browser-password-1234");
  await page.getByLabel("Confirm password", { exact: true }).fill("changed-browser-password-1234");
  // When: the user saves the new password.
  const confirmed = page.waitForResponse(response => response.url().endsWith("/api/auth/password-reset/confirm"));
  await page.getByRole("button", { name: "Save new password" }).click();
  assert.equal((await confirmed).status(), 200);
  // Then: login with the newly persisted password succeeds through the real form.
  await page.goto(origin + "/sign-in", { waitUntil: "commit" });
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(mailbox.email);
  await page.getByLabel("Password", { exact: true }).fill("changed-browser-password-1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Project navigation reached" }).waitFor({ state: "visible", timeout: 10000 });
}
