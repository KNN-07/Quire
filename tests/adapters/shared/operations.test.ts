import { expect, test } from "bun:test";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { connectedFixture } from "./connected-fixture";
import { errorEnvelope } from "./harness";

const operationEnvelope = z.object({ data: OperationSchema });
test("commits cursor receipt and notification once when an operation is replayed after restart", async () => {
  // Given
  await using setup = await connectedFixture();
  const key = crypto.randomUUID();
  const first = operationEnvelope.parse(await (await setup.action({ value: "persisted" }, { key })).json()).data;
  await setup.fixture.restart();
  // When
  const replay = await setup.action({ value: "persisted" }, { key });
  // Then
  expect(operationEnvelope.parse(await replay.json()).data).toEqual(first);
  expect(first.status).toBe("succeeded");
  expect(first.result).toEqual({ value: "persisted" });
  expect(setup.provider.calls).toBe(1);
  expect(await setup.fixture.runtime.db.get<{ cursor: string; version: number }>(
    "SELECT cursor,version FROM adapter_cursors WHERE grant_id=?", [setup.grant.id])).toEqual({ cursor: "1", version: 1 });
  expect(await setup.fixture.runtime.db.get<{ n: number }>(
    "SELECT count(*) AS n FROM notifications WHERE kind='fixture.synced'")).toEqual({ n: 1 });
  const events = await setup.fixture.runtime.events.read(0, { aggregateId: first.id });
  expect(events.map((event) => event.payload)).toEqual([
    { resourceId: first.id, status: "running" }, { resourceId: first.id, status: "succeeded" },
  ]);
});
test("rejects key reuse when the parameters differ from the stored receipt", async () => {
  // Given
  await using setup = await connectedFixture();
  const key = crypto.randomUUID();
  expect((await setup.action({ value: "first" }, { key })).status).toBe(202);
  // When
  const conflict = await setup.action({ value: "different" }, { key });
  // Then
  expect(errorEnvelope.parse(await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  expect(setup.provider.calls).toBe(1);
});
test("rejects a stale cursor before dispatch when another operation has advanced it", async () => {
  // Given
  await using setup = await connectedFixture();
  expect((await setup.action()).status).toBe(202);
  // When
  const stale = await setup.action({ value: "second" });
  // Then
  expect(errorEnvelope.parse(await stale.json()).error.code).toBe("CURSOR_CONFLICT");
  expect(setup.provider.calls).toBe(1);
});
test("rolls back prepared publication when its transaction fails", async () => {
  // Given
  await using setup = await connectedFixture({ publicationFailure: true });
  // When
  const response = await setup.action();
  // Then
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("FIXTURE_PUBLICATION_FAILED");
  expect(setup.provider.calls).toBe(1);
  expect(await setup.fixture.runtime.db.all("SELECT cursor FROM adapter_cursors")).toEqual([]);
  expect(await setup.fixture.runtime.db.all("SELECT id FROM notifications WHERE kind='fixture.synced'")).toEqual([]);
  expect(await setup.fixture.runtime.db.get<{ status: string; error_code: string }>(
    "SELECT status,error_code FROM operations WHERE kind='fixture.sync'"))
    .toEqual({ status: "failed", error_code: "FIXTURE_PUBLICATION_FAILED" });
});
test("parses action parameters before provider dispatch when a request violates its schema", async () => {
  // Given
  await using setup = await connectedFixture();
  // When
  const response = await setup.action({ unexpected: "missing required value" });
  // Then
  expect(response.status).toBe(400);
  expect(setup.provider.calls).toBe(0);
});
test("rejects provider credential leakage before publishing the result", async () => {
  // Given
  await using setup = await connectedFixture();
  // When
  const response = await setup.action({}, { action: "leak" });
  // Then
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("PROVIDER_SECRET_LEAK");
  const receipt = await setup.fixture.runtime.db.get<{ result_json: string | null; error_code: string }>(
    "SELECT result_json,error_code FROM operations WHERE kind='fixture.leak'");
  expect(receipt).toEqual({ result_json: null, error_code: "PROVIDER_SECRET_LEAK" });
});
test("denies project publication when the grant owner lacks project authority", async () => {
  // Given
  await using setup = await connectedFixture({ projectAccess: "write" });
  const other = await setup.fixture.login("outsider@quire.local");
  const project = await setup.fixture.create(other.headers);
  // When
  const response = await setup.action({ value: "forbidden" }, { projectId: project.id });
  // Then
  expect(response.status).toBe(404);
  expect(setup.provider.calls).toBe(0);
});
