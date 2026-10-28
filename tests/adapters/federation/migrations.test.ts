import { expect, test } from "bun:test";
import { migrateDatabase } from "@quire/runtime";
import { migrations } from "../../../services/adapters/federation";
import { fixture } from "./harness";

test("preserves all applied migration receipts when federation migrations are re-applied", async () => {
  // Given
  await using app = await fixture();
  const original = await app.runtime.db.all("SELECT id,digest,applied_at FROM schema_migrations ORDER BY id");
  // When
  await migrateDatabase(app.runtime.uow, migrations);
  // Then
  expect(await app.runtime.db.all("SELECT id,digest,applied_at FROM schema_migrations ORDER BY id")).toEqual(original);
  expect(await app.runtime.db.all("PRAGMA foreign_key_check")).toEqual([]);
});
