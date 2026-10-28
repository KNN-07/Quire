import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { stat } from "node:fs/promises";
import { adapterFixture } from "./harness";
import { migrations } from "../../../services/adapters/shared";

test("retains every applied migration receipt when the shared runtime reopens", async () => {
  // Given
  await using fixture = await adapterFixture({ contributions: [] });
  const before = await fixture.runtime.db.all("SELECT id,digest,applied_at FROM schema_migrations ORDER BY id");
  const migration = migrations[0];
  if (!migration) throw new TypeError("Shared migration required");
  // When
  await fixture.restart();
  // Then
  expect(await fixture.runtime.db.all("SELECT id,digest,applied_at FROM schema_migrations ORDER BY id")).toEqual(before);
  expect(await fixture.runtime.db.get<{ digest: string }>("SELECT digest FROM schema_migrations WHERE id=?", [migration.id]))
    .toEqual({ digest: new Bun.CryptoHasher("sha256").update(migration.sql).digest("hex") });
  expect(migration.postgres).toBeDefined();
});
test("closes the actual listener and temporary database root when a fixture is disposed", async () => {
  // Given
  const fixture = await adapterFixture({ contributions: [] });
  const { path, origin } = fixture;
  // When
  await fixture[Symbol.asyncDispose]();
  // Then
  await rejects(stat(path), { code: "ENOENT" });
  await rejects(fetch(origin, { signal: AbortSignal.timeout(1_000) }));
});
