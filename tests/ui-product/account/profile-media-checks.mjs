import assert from "node:assert/strict";

export async function checkProfileMedia(page, origin, extraEmail) {
  // Given: an actual profile and a valid one-pixel PNG file.
  await page.goto(origin + "/settings/profile", { waitUntil: "commit" });
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("Profile photo", { exact: true }).setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: image });
  // When: the real multipart upload persists the photo.
  const uploaded = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/api/me/avatar"));
  const imageRead = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith("/api/me/avatar"), { timeout: 10000 });
  await page.getByRole("button", { name: "Upload photo", exact: true }).click();
  assert.equal((await uploaded).status(), 200);
  // Then: the authenticated byte-read endpoint supplies a decodable saved image.
  const photo = page.getByRole("img", { name: "Profile photo", exact: true });
  await photo.waitFor({ state: "visible", timeout: 10000 });
  await photo.evaluate(element => element.decode());
  assert.equal(await photo.evaluate(element => element.naturalWidth), 1);
  const savedRead = await imageRead;
  const me = await (await page.request.get(origin + "/api/me")).json();
  const etag = await savedRead.headerValue("etag");
  assert.equal(etag, `"${me.data.user.avatarBlob}"`);
  assert.match(await savedRead.headerValue("cache-control"), /private/);
  assert.match(await savedRead.headerValue("cache-control"), /no-store/);
  assert.equal(new URL(await photo.getAttribute("src")).pathname, "/api/me/avatar");

  // Given: identical bytes, so avatarBlob and the content ETag will not change.
  // When: the same photo is uploaded again with the fresh account version.
  const uploadedAgain = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/api/me/avatar"));
  const readAgain = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith("/api/me/avatar"), { timeout: 10000 });
  await page.getByRole("button", { name: "Upload photo", exact: true }).click();
  assert.equal((await uploadedAgain).status(), 200);
  // Then: a new authenticated GET occurs and returns the same real content ETag.
  assert.equal(await (await readAgain).headerValue("etag"), etag);
  await photo.evaluate(element => element.decode());

  // Given: that saved photo.
  // When: the user removes it.
  const removed = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().endsWith("/api/me/avatar"));
  await page.getByRole("button", { name: "Remove photo", exact: true }).click();
  assert.equal((await removed).status(), 200);
  // Then: the image is replaced by the no-photo state.
  await photo.waitFor({ state: "hidden", timeout: 10000 });

  // Given: an additional verified email loaded from the real account.
  // When: it is removed with the contract's email selector.
  const deleted = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().endsWith("/api/me/emails"));
  await page.getByRole("button", { name: "Remove " + extraEmail, exact: true }).click();
  const response = await deleted;
  assert.equal(response.status(), 200);
  // Then: the refreshed saved account no longer exposes that remove control.
  await page.getByRole("button", { name: "Remove " + extraEmail, exact: true }).waitFor({ state: "hidden", timeout: 10000 });
}
