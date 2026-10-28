import { expect, spyOn, test } from "bun:test";
import { baseFixture } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";

test.each(["revoked", "expired"] as const)("rejects writable selection when the verified session becomes %s", async state => {
  // Given: actual mutation verification followed by a committed session change.
  await using app = await baseFixture();
  const owner = await app.login();
  const identity = app.runtime.services.get("identity");
  const principal = await identity.require(new Request("http://localhost", { headers: owner.headers }));
  const verify = identity.verifyMutation.bind(identity);
  const before = await app.runtime.db.get("SELECT writable_member_ids_json,version FROM projects WHERE id=?", [fixtureIds.project]);
  const barrier = spyOn(identity, "verifyMutation").mockImplementationOnce(async (...args) => {
    await verify(...args);
    await app.runtime.uow.run(async tx => {
      await tx.lock("quire:accounts");
      if (state === "revoked") await tx.run("DELETE FROM sessions WHERE id=?", [principal.sessionId]);
      else await tx.run("UPDATE sessions SET expires_at=? WHERE id=?", [app.runtime.clock.now(), principal.sessionId]);
    });
  });
  try {
    // When: the real handler reaches its final authority transaction.
    const response = await app.request(`/api/projects/${fixtureIds.project}/writable-members`, {
      method: "PUT", headers: owner.headers, body: JSON.stringify({ memberIds: [], expectedVersion: 0 }),
    });
    // Then: authentication fails without publishing selection or version changes.
    expect(response.status).toBe(401);
    expect(await app.runtime.db.get("SELECT writable_member_ids_json,version FROM projects WHERE id=?", [fixtureIds.project]))
      .toEqual(before);
  } finally { barrier.mockRestore(); }
});
