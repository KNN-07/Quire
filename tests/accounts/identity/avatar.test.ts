import { expect, test } from "bun:test";
import { identityFixture } from "./harness";

test("returns private 404 instead of another user's stored avatar when the caller has none", async () => {
  // Given: an actual PNG stored for one account and another authenticated account without an avatar.
  await using fixture = await identityFixture({ seed: true });
  const owner = await fixture.login();
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8WQAAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.set("file", new File([bytes], "avatar.png", { type: "image/png" }));
  form.set("expectedVersion", "0");
  const uploaded = await fixture.request("/api/me/avatar", { method: "PUT",
    headers: { ...owner.headers, "if-match": '"v0"' }, body: form });
  expect(uploaded.status).toBe(200);
  const other = await fixture.login("mai@quire.local");
  // When: the other account requests its own absent avatar.
  const response = await fixture.request("/api/me/avatar", { headers: other.headers });
  // Then: no image from another account is exposed or cached publicly.
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
