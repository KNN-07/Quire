import { expect, test } from "bun:test";
import { Library } from "../../../services/core/catalog";
import { referencesFixture } from "./harness";
import { referenceProvider } from "./provider";

test("updates stable account source IDs and removes departed collection records on manual sync", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const selection = { libraryType: "users", libraryId: "123", collectionKey: "ABCD1234" } as const;
  await fixture.action(owner, grant, { action: "librarySync", parameters: { selection } });
  const library = new Library({ ...fixture.runtime, routes: fixture.runtime.routes.forLane("X") });
  const original = (await library.list(owner.user.id)).find(entry => entry.citationKey === "stable_key_0");
  if (!original) throw new TypeError("First synced record required");
  provider.state.pages = 1;
  provider.state.version = 8;
  provider.state.title = "Updated collection metadata";
  // When
  const response = await fixture.action(owner, grant, { action: "librarySync", parameters: { selection }, expectedCursor: "7" });
  // Then
  expect(response.status).toBe(202);
  const entries = await library.list(owner.user.id);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ id: original.id, citationKey: original.citationKey, readonly: true,
    version: original.version + 1, publication: { title: "Updated collection metadata" } });
});
