import { expect, spyOn, test } from "bun:test";
import { governanceFixture } from "./harness";

test.each(["revoked", "expired"] as const)("rejects a grant when the verified operator session becomes %s", async state => {
  // Given: a genuine operator mutation whose session changes before finalization.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const identity = app.runtime.services.get("identity");
  const verify = identity.verifyMutation.bind(identity);
  const query = "SELECT benefits_json,version FROM account_project_benefits WHERE scope_kind='deployment' AND scope_id='local'";
  const before = await app.runtime.db.get(query);
  const barrier = spyOn(identity, "verifyMutation").mockImplementationOnce(async (...args) => {
    await verify(...args);
    await app.runtime.uow.run(async tx => {
      await tx.lock("quire:accounts");
      if (state === "revoked") await tx.run("DELETE FROM sessions WHERE id=?", [operator.principal.sessionId]);
      else await tx.run("UPDATE sessions SET expires_at=? WHERE id=?", [app.runtime.clock.now(), operator.principal.sessionId]);
    });
  });
  try {
    // When: the actual grant route executes under the accounts lock.
    const response = await operator.write("/api/admin/project-benefits/deployment/local", {
      benefits: { compileSeconds: 12, writableMembers: 0, historyDays: 0, trackChanges: false }, expectedVersion: 0,
    }, { method: "PUT" });
    // Then: the independent session fence denies the change and preserves the grant.
    expect(response.status).toBe(403);
    expect(await app.runtime.db.get(query)).toEqual(before);
  } finally { barrier.mockRestore(); }
});
