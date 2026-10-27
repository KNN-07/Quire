import { expect, test } from "bun:test";
import { identityFixture, password } from "./harness";

test("isolates an exhausted login budget from unrelated accounts", async () => {
  // Given: one account's persisted login bucket has reached its allowed budget.
  await using app = await identityFixture({ seed: true });
  await app.login("kien@quire.local");
  app.runtime.db.query("UPDATE identity_rate_limits SET attempts=30").run();
  // When: that account and a different account each attempt a real password login.
  const statuses = [];
  for (const email of ["kien@quire.local", "mai@quire.local"]) {
    const response = await app.request("/api/auth/login", { method: "POST",
      body: JSON.stringify({ email, password }) });
    statuses.push(response.status);
  }
  // Then: one exhausted account does not lock the whole instance out.
  expect(statuses).toEqual([429, 200]);
});
