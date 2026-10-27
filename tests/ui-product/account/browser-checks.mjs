import assert from "node:assert/strict";

// These assertions drive the real AccountPage bundle and same-origin API.
export async function checkAuthentication(page, origin, password) {
  // Given: a seeded verified identity and a real sign-in form.
  await page.goto(origin + "/sign-in", { waitUntil: "commit" });
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("kien@quire.local");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  // When: credentials are rejected by the real identity service.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Then: the form remains visible, and the service error is actionable.
  await page.getByRole("alert").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(new URL(await page.evaluate(() => location.href)).pathname, "/sign-in");
  assert.equal(await page.getByRole("textbox", { name: "Email", exact: true }).inputValue(), "kien@quire.local");

  // Given: the corrected password on the same form.
  await page.getByLabel("Password", { exact: true }).fill(password);
  // When: login succeeds and the router refreshes /me.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Then: navigation occurs only after the real session can be read.
  await page.getByRole("heading", { name: "Project navigation reached" }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("status", { name: "Destination" }).textContent(), "/projects");
}

export async function checkProfile(page, origin, name) {
  // Given: the actual persisted profile.
  await page.goto(origin + "/settings/profile", { waitUntil: "commit" });
  await page.getByRole("textbox", { name: "Full name", exact: true }).fill(name);
  // When: the user saves the profile with the returned account version.
  const saved = page.waitForResponse(response => response.url().endsWith("/api/me") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.equal((await saved).status(), 200);
  // Then: a fresh page reads the saved value from SQLite through /me.
  await page.goto(origin + "/settings/profile", { waitUntil: "commit" });
  await page.getByRole("textbox", { name: "Full name", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("textbox", { name: "Full name", exact: true }).inputValue(), name);
}

export async function checkPreferences(page, origin, size) {
  // Given: editor preferences loaded from the identity service.
  await page.goto(origin + "/settings/editor", { waitUntil: "commit" });
  await page.getByRole("spinbutton", { name: "Font size" }).fill(String(size));
  // When: the user saves their editor defaults.
  const saved = page.waitForResponse(response => response.url().endsWith("/api/me/preferences") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.equal((await saved).status(), 200);
  // Then: the saved value survives a browser reload.
  await page.goto(origin + "/settings/editor", { waitUntil: "commit" });
  await page.getByRole("spinbutton", { name: "Font size" }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("spinbutton", { name: "Font size" }).inputValue(), String(size));
}

export async function checkReset(page, origin) {
  // Given: a real reset URL with an invalid token.
  await page.goto(origin + "/reset-password?token=invalid-token", { waitUntil: "commit" });
  await page.getByLabel("New password", { exact: true }).fill("new-password-1234");
  await page.getByLabel("Confirm password", { exact: true }).fill("different-password-1234");
  // When: the user submits mismatched passwords.
  await page.getByRole("button", { name: "Save new password" }).click();
  // Then: local validation retains the form.
  await page.getByRole("alert").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.getByLabel("Confirm password", { exact: true }).inputValue(), "different-password-1234");

  // Given: matching passwords, but the same invalid token.
  await page.getByLabel("Confirm password", { exact: true }).fill("new-password-1234");
  // When: the real reset service validates the token.
  const rejected = page.waitForResponse(response => response.url().endsWith("/api/auth/password-reset/confirm"));
  await page.getByRole("button", { name: "Save new password" }).click();
  assert.ok((await rejected).status() >= 400);
  // Then: it rejects the token, without showing a fabricated success state.
  await page.getByRole("alert").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(new URL(await page.evaluate(() => location.href)).pathname, "/reset-password");
  assert.equal(await page.getByLabel("New password", { exact: true }).inputValue(), "new-password-1234");
}

export async function measure(page) {
  return page.evaluate(() => ({
    width: innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    controls: [...document.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)")].filter(element => element.getClientRects().length).map(element => ({
      name: element.name || element.textContent,
      height: (element.type === "checkbox" ? element.closest("label") ?? element : element).getBoundingClientRect().height,
    })),
    avatar: (() => { const element = document.querySelector(".account-avatar"); if (!element) return null; const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }; })(),
    resetFillsViewport: (() => { const element = document.querySelector(".account-reset"); return element ? element.getBoundingClientRect().height >= innerHeight : null; })(),
    scrollOwners: [...document.querySelectorAll("*")].filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight).map(element => element.className).concat(document.scrollingElement.scrollHeight > innerHeight ? ["document"] : []),
  }));
}

export async function checkRegistration(page, origin, email, verificationLink) {
  // Given: the actual account-registration form and an unused email.
  await page.goto(origin + "/sign-up", { waitUntil: "commit" });
  await page.getByRole("textbox", { name: "Full name", exact: true }).fill("New Browser Author");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("registration-browser-1234");
  // When: the user registers through the real identity service.
  const registered = page.waitForResponse(response => response.url().endsWith("/api/auth/register"));
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  assert.equal((await registered).status(), 200);
  // Then: verification is required; the local mail outbox carries a real token.
  await page.getByRole("textbox", { name: "Verification token", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const link = verificationLink(email);
  assert.equal(link.pathname, "/verify-email");

  // Given: the actual verification URL from the operator-only test mailbox.
  await page.goto(origin + link.pathname + link.search, { waitUntil: "commit" });
  // When: the user verifies the one-time token.
  const verified = page.waitForResponse(response => response.url().endsWith("/api/auth/verify-email"));
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  assert.equal((await verified).status(), 200);
  // Then: the account remains on verification rather than fabricating a login.
  assert.equal(new URL(await page.evaluate(() => location.href)).pathname, "/verify-email");
}

export async function checkUnbilled(page, origin, fixture) {
  // Given: billing services are unavailable; only their HTTP boundary is faked.
  const envelope = data => JSON.stringify({ data, requestId: fixture.requestId });
  await page.route("**/api/billing/catalog", route => route.fulfill({ status: 200, contentType: "application/json", body: envelope({ configured: false, plans: [] }) }));
  await page.route("**/api/organizations?*", route => route.fulfill({ status: 200, contentType: "application/json", body: envelope({ items: [fixture.organization], nextCursor: null }) }));
  await page.route("**/api/organizations/*/billing", route => route.fulfill({ status: 200, contentType: "application/json", body: envelope(fixture.billing) }));
  // When: the real billing screen reads an unconfigured catalog and unbilled account.
  await page.goto(origin + "/settings/billing", { waitUntil: "commit" });
  await page.getByRole("heading", { name: "Current subscription" }).waitFor({ state: "visible", timeout: 10000 });
  // Then: it offers no checkout or fabricated price.
  assert.equal(await page.getByRole("button", { name: "Request checkout" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Preview plan" }).count(), 0);
  assert.equal(await page.getByRole("textbox", { name: "Invoice email" }).inputValue(), fixture.billing.invoiceEmail);
}

export async function checkVersionConflict(page, origin, changeVersion) {
  // Given: a form based on a real account version, superseded by another writer.
  await page.goto(origin + "/settings/profile", { waitUntil: "commit" });
  await page.getByRole("textbox", { name: "Full name", exact: true }).fill("Unsaved conflicting name");
  changeVersion();
  // When: the stale form attempts to save.
  const rejected = page.waitForResponse(response => response.url().endsWith("/api/me") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.equal((await rejected).status(), 409);
  // Then: edits remain visible and the real recovery action becomes available.
  await page.getByRole("button", { name: "Reload current profile" }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("textbox", { name: "Full name", exact: true }).inputValue(), "Unsaved conflicting name");
}

export async function checkPreferenceTabs(page, origin) {
  for (const [tab, label] of [["ai", "Show the assistant to collaborators"], ["git", "Compile before every commit"]]) {
    // Given: the persisted preference on its actual tab.
    await page.goto(origin + "/settings/" + tab, { waitUntil: "commit" });
    const checkbox = page.getByRole("checkbox", { name: label, exact: true });
    await checkbox.waitFor({ state: "visible", timeout: 10000 });
    const previous = await checkbox.isChecked();
    // When: the user changes that preference and saves.
    await checkbox.setChecked(!previous);
    const saved = page.waitForResponse(response => response.url().endsWith("/api/me/preferences") && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    assert.equal((await saved).status(), 200);
    // Then: the changed value survives a reload through the actual service.
    await page.goto(origin + "/settings/" + tab, { waitUntil: "commit" });
    await checkbox.waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await checkbox.isChecked(), !previous);
  }
}
