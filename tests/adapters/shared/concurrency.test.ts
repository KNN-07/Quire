import { expect, test } from "bun:test";
import { abortable } from "../../../services/adapters/shared/cancellation";
import { connectedFixture } from "./connected-fixture";
import { errorEnvelope } from "./harness";

test("rejects stale publication when the actor is suspended during provider work", async () => {
  // Given
  await using setup = await connectedFixture();
  const barrier = setup.provider.pauseNextAction();
  // When
  const response = setup.action();
  try {
    await abortable(() => barrier.entered, AbortSignal.timeout(5_000));
    await setup.fixture.runtime.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await tx.run("UPDATE users SET suspended=1 WHERE id=?", [setup.owner.user.id]);
    });
  } finally { barrier.release(); }
  // Then
  expect(errorEnvelope.parse(await (await response).json()).error.code).toBe("UNAUTHENTICATED");
  expect(await setup.fixture.runtime.db.all("SELECT id FROM notifications WHERE kind='fixture.synced'")).toEqual([]);
  expect(await setup.fixture.runtime.db.all("SELECT cursor FROM adapter_cursors")).toEqual([]);
});
test("denies competing grant use while a provider request owns its durable claim", async () => {
  // Given
  await using setup = await connectedFixture();
  const barrier = setup.provider.pauseNextAction();
  const first = setup.action();
  await abortable(() => barrier.entered, AbortSignal.timeout(5_000));
  // When
  let competing: Response;
  try { competing = await setup.action(); }
  finally { barrier.release(); }
  // Then
  expect(errorEnvelope.parse(await competing.json()).error.code).toBe("GRANT_BUSY");
  expect((await first).status).toBe(202);
  expect(setup.provider.calls).toBe(1);
});
test("rejects publication when account lifecycle clears a grant without changing its version", async () => {
  // Given
  await using setup = await connectedFixture();
  const barrier = setup.provider.pauseNextAction();
  // When
  const response = setup.action();
  try {
    await abortable(() => barrier.entered, AbortSignal.timeout(5_000));
    await setup.fixture.runtime.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await tx.run("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL WHERE id=?", [setup.grant.id]);
    });
  } finally { barrier.release(); }
  // Then
  expect(errorEnvelope.parse(await (await response).json()).error.code).toBe("GRANT_UNAVAILABLE");
  expect(await setup.fixture.runtime.db.all("SELECT cursor FROM adapter_cursors")).toEqual([]);
});
