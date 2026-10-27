import assert from "node:assert/strict";

export async function checkAuthOptions(page, origin) {
  // Given: only the unavailable federation boundary is supplied as a fixture.
  await page.route("**/api/auth/options", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    data: { passwordEnabled: false, registrationEnabled: false, providers: [
      { id: "test-oidc", label: "University SSO", capability: { enabled: true, state: "ready" } },
      { id: "orcid", label: "ORCID", capability: { enabled: false, state: "unconfigured", reason: "ORCID credentials are not configured." } },
    ] }, requestId: "00000000-0000-4000-8000-000000000001",
  }) }));
  await page.goto(origin + "/sign-in", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Continue with University SSO" }).waitFor({ state: "visible", timeout: 10000 });
  // Then: actual availability, not loading defaults, governs the controls.
  assert.equal(await page.getByRole("button", { name: "Continue with University SSO" }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Continue with ORCID" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isDisabled(), true);
  await page.goto(origin + "/sign-up", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Continue with University SSO" }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("button", { name: "Create account", exact: true }).isDisabled(), true);
  await page.route("**/api/auth/test-oidc/start?*", route => route.fulfill({ status: 503, contentType: "text/plain", body: "Federation fixture: provider unavailable." }));
  // When: the user starts an enabled provider from signup.
  const started = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/test-oidc/start");
  await page.getByRole("button", { name: "Continue with University SSO" }).click();
  const response = await started;
  // Then: the checked provider endpoint and exact returnTo are used, without success fabrication.
  assert.equal(new URL(response.url()).searchParams.get("returnTo"), "/sign-up?step=start");
  assert.equal(response.status(), 503);
  await page.unroute("**/api/auth/options");
  await page.unroute("**/api/auth/test-oidc/start?*");
}

export async function checkSavedNotifications(page, origin, ids) {
  let preferences = { events: { mention: true, share: false, custom_saved_event: true }, channels: ["email"], projectOverrides: { [ids.project]: { mention: false, custom_override: true } }, version: 17 };
  const envelope = data => JSON.stringify({ data, requestId: ids.kien });
  // Given: saved notification values differ from defaults and include unknown event keys.
  await page.route("**/api/me/notification-preferences", async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: envelope(preferences) });
    const body = route.request().postDataJSON();
    assert.equal(body.expectedVersion, 17);
    assert.equal(body.events.custom_saved_event, true);
    assert.deepEqual(body.projectOverrides, { [ids.project]: { mention: false, custom_override: true } });
    const { expectedVersion, ...next } = body;
    preferences = { ...next, version: expectedVersion + 1 };
    return route.fulfill({ status: 200, contentType: "application/json", body: envelope({ ok: true, version: preferences.version }) });
  });
  await page.goto(origin + "/settings/notifications", { waitUntil: "commit" });
  const mentions = page.getByRole("checkbox", { name: "Someone mentions me", exact: true });
  await mentions.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await mentions.isChecked(), true);
  assert.equal(await page.getByRole("checkbox", { name: "Email", exact: true }).isChecked(), true);
  assert.equal(await page.getByRole("checkbox", { name: "In app", exact: true }).isChecked(), false);
  assert.equal(await page.getByRole("checkbox", { name: "custom_saved_event", exact: true }).isChecked(), true);
  // When: one preference changes in the actual React form.
  await page.getByRole("checkbox", { name: "A project is shared with me", exact: true }).check();
  const saved = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith("/api/me/notification-preferences"));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.equal((await saved).status(), 200);
  // Then: the saved value and unrelated overrides survive a fresh read.
  await page.goto(origin + "/settings/notifications", { waitUntil: "commit" });
  await mentions.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("checkbox", { name: "A project is shared with me", exact: true }).isChecked(), true);
  assert.equal(await page.getByRole("checkbox", { name: "custom_override", exact: true }).isChecked(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  return page.screenshot({ fullPage: true, type: "png" });
}

export async function checkNativeSessionAndIdentities(page, origin, sessionId) {
  // Given: a real SQLite-backed linked identity and second session with version 9.
  await page.goto(origin + "/settings/security", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Unlink test-oidc" }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByRole("button", { name: "Unlink test-oidc" }).isEnabled(), true);
  // When: the second session is revoked through its actual HTTP service.
  const revoked = page.waitForResponse(response => response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api/me/sessions/${sessionId}`);
  await page.getByRole("button", { name: "Revoke session", exact: true }).click();
  const response = await revoked;
  // Then: the correct saved version, not zero/account version, reaches the server.
  // The real handler atomically compares the stored counter (9); a guessed 0 returns 409.
  assert.equal(response.status(), 200);
  await page.getByRole("button", { name: "Revoke session", exact: true }).waitFor({ state: "hidden", timeout: 10000 });
}

export async function checkIdentityAccountCounter(page, origin, ids) {
  // Given: /me's real account counter differs from the identities-list metadata.
  const me = await page.request.get(origin + "/api/me");
  const etag = me.headers()["etag"];
  assert.match(etag, /^"v\d+"$/);
  const expectedVersion = Number(etag.slice(2, -1));
  assert.ok(expectedVersion > 0);
  assert.notEqual(expectedVersion, 999);
  await page.route("**/api/me/identities?*", route => route.fulfill({ status: 200, contentType: "application/json", headers: { etag: '"v999"' }, body: JSON.stringify({
    data: { items: [{ id: ids.outsider, issuer: "test-oidc", subject: "saved-author-subject", createdAt: "2026-10-26T00:00:00.000Z" }], nextCursor: null }, requestId: ids.kien,
  }) }));
  let sentVersion;
  await page.route("**/api/me/identities/" + ids.outsider, route => {
    sentVersion = route.request().postDataJSON().expectedVersion;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({
      error: { code: "PROVIDER_UNCONFIGURED", message: "Identity-provider fixture is unconfigured." }, requestId: ids.kien,
    }) });
  });
  await page.goto(origin + "/settings/security", { waitUntil: "commit" });
  // When: unlink is requested from the actual React control.
  const attempted = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().endsWith("/api/me/identities/" + ids.outsider));
  await page.getByRole("button", { name: "Unlink test-oidc" }).click();
  assert.equal((await attempted).status(), 503);
  // Then: /me's ETag wins, and provider unavailability remains an explicit error.
  assert.equal(sentVersion, expectedVersion);
  await page.getByRole("alert").waitFor({ state: "visible", timeout: 10000 });
  await page.unroute("**/api/me/identities?*");
  await page.unroute("**/api/me/identities/" + ids.outsider);
}
