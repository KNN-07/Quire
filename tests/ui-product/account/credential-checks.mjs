import assert from "node:assert/strict";

export async function checkCredentialBoundary(page, origin, ids) {
  const tokens = [];
  const keys = [];
  const calls = [];
  const envelope = data => JSON.stringify({ data, requestId: ids.kien });
  // Given: unavailable credential services are replaced only at the HTTP boundary.
  await page.route("**/api/me/git-tokens**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const body = request.method() === "GET" ? null : request.postDataJSON();
    calls.push({ path, method: request.method(), body, key: request.headers()["idempotency-key"] });
    let data;
    if (request.method() === "GET") data = { items: tokens, nextCursor: null };
    else if (request.method() === "POST") {
      assert.ok(request.headers()["idempotency-key"]);
      tokens.push({ id: ids.mai, name: body.name, expiresAt: body.expiresAt, createdAt: "2026-10-26T00:00:00.000Z", version: 7 });
      data = { id: ids.mai, secretOnce: "test-only-secret" };
    } else {
      assert.equal(body.expectedVersion, 7);
      tokens.length = 0; data = { ok: true, version: 8 };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: envelope(data) });
  });
  await page.route("**/api/me/ssh-keys**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const body = request.method() === "GET" ? null : request.postDataJSON();
    let data;
    if (request.method() === "GET") data = path.endsWith("/ssh-keys") ? { items: keys, nextCursor: null } : keys[0];
    else if (request.method() === "POST") {
      assert.ok(request.headers()["idempotency-key"]);
      const key = { id: ids.sam, name: body.name, publicKey: body.publicKey, version: 9 };
      keys.push(key); data = key;
    } else {
      assert.equal(body.expectedVersion, 9); keys.length = 0; data = { ok: true, version: 10 };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: envelope(data) });
  });
  await page.goto(origin + "/settings/git", { waitUntil: "commit" });
  await page.getByRole("textbox", { name: "Token name" }).fill("test-cli");
  await page.getByLabel("Expires at").fill("2030-01-01T12:00");
  // When: a token is created by the real React form and checked client.
  await page.getByRole("button", { name: "Generate token" }).click();
  await page.getByRole("status", { name: "New Git token" }).waitFor({ state: "visible", timeout: 10000 });
  // Then: its one-time secret is exposed explicitly, and can be hidden.
  assert.equal(await page.getByRole("status", { name: "New Git token" }).textContent(), "test-only-secret");
  await page.getByRole("button", { name: "Hide token" }).click();
  assert.equal(await page.getByRole("status", { name: "New Git token" }).count(), 0);

  // Given: the token's server-supplied version is 7, not the account version.
  // When: the user revokes the token.
  const revoked = page.waitForResponse(response => response.url().endsWith("/api/me/git-tokens/" + ids.mai) && response.request().method() === "DELETE");
  await page.getByRole("button", { name: "Revoke test-cli" }).click();
  await revoked;
  // Then: the correct returned token version was sent to the boundary.
  assert.equal(calls.find(call => call.method === "DELETE").body.expectedVersion, 7);

  // Given: a public SSH key in the real add-key form.
  await page.getByRole("textbox", { name: "SSH key name" }).fill("test-key");
  await page.getByRole("textbox", { name: "Public key" }).fill("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnlyBoundary test");
  // When: the user saves and then removes the key.
  await page.getByRole("button", { name: "Add SSH key", exact: true }).click();
  await page.getByRole("button", { name: "Remove test-key" }).waitFor({ state: "visible", timeout: 10000 });
  const removed = page.waitForResponse(response => response.url().endsWith("/api/me/ssh-keys/" + ids.sam) && response.request().method() === "DELETE");
  await page.getByRole("button", { name: "Remove test-key" }).click();
  await removed;
  // Then: the detail-read key version was used, and the boundary removed it.
  await page.getByRole("button", { name: "Remove test-key" }).waitFor({ state: "hidden", timeout: 10000 });
}
