import { expect, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { UpdateOperationQuerySchema } from "../../../services/operations/installation/model";
import { at, controlFixture, id } from "./control-fixture";

test("pages control receipts in both bounded directions while preserving actor filters", async () => {
  // Given: real durable receipts inserted out of lexical order.
  await using fixture = await controlFixture();
  const ids: readonly [Id, Id, Id] = [
    IdSchema.parse("00000000-0000-4000-8000-000000000011"),
    IdSchema.parse("00000000-0000-4000-8000-000000000012"),
    IdSchema.parse("00000000-0000-4000-8000-000000000013"),
  ];
  const other = id();
  for (const index of [2, 0, 1]) {
    const operationId = ids[index];
    if (!operationId) throw new TypeError("Missing pagination fixture ID");
    fixture.store.accept({ ...fixture.command(`page-${index}`), operationId,
      actorId: index === 1 ? other : fixture.actorId }, fixture.release, at);
  }
  // When / Then: ascending cursor pages never rescan previously returned receipt IDs.
  const first = fixture.store.list(UpdateOperationQuerySchema.parse({ order: "asc", limit: 1 }));
  expect(first.map(row => row.operation.id)).toEqual([ids[0]]);
  const second = fixture.store.list(UpdateOperationQuerySchema.parse({ order: "asc", limit: 1, cursor: first[0]?.operation.id }));
  expect(second.map(row => row.operation.id)).toEqual([ids[1]]);
  const third = fixture.store.list(UpdateOperationQuerySchema.parse({ order: "asc", limit: 1, cursor: second[0]?.operation.id }));
  expect(third.map(row => row.operation.id)).toEqual([ids[2]]);
  expect(fixture.store.list(UpdateOperationQuerySchema.parse({ order: "asc", limit: 1, cursor: third[0]?.operation.id }))).toEqual([]);
  expect(fixture.store.list({ limit: 2 }).map(row => row.operation.id)).toEqual([ids[2], ids[1]]);
  expect(fixture.store.list({ limit: 2, cursor: ids[1] }).map(row => row.operation.id)).toEqual([ids[0]]);
  expect(fixture.store.list(UpdateOperationQuerySchema.parse({ order: "asc", limit: 2,
    actorId: fixture.actorId, kind: "update", status: "queued" })).map(row => row.operation.id)).toEqual([ids[0], ids[2]]);
  expect(fixture.store.list({ limit: 2, kind: "other" })).toEqual([]);
  expect(fixture.store.list({ limit: 2, status: "succeeded" })).toEqual([]);
});

test("keeps the old query bytes unchanged and rejects unknown ordering", () => {
  // Given / When / Then: omitted ordering keeps its existing wire shape and descending semantics.
  expect(UpdateOperationQuerySchema.parse({ limit: 10 })).toEqual({ limit: 10 });
  expect(() => UpdateOperationQuerySchema.parse({ limit: 1, order: "unknown" })).toThrow();
});
