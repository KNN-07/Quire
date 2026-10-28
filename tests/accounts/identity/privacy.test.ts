import { expect, test } from "bun:test";
import { identityFixture, password } from "./harness";

test("account deletion removes primary, verified and pending address mail regardless of stored casing", async () => {
  await using app = await identityFixture({ seed: true });
  const user = await app.login("outsider@quire.local");
  await app.runtime.db.run("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)",
    [crypto.randomUUID(), user.user.id, "Verified@Example.Test", app.runtime.clock.now()]);
  await app.runtime.db.run(
    "INSERT INTO one_time_tokens(id,user_id,token_hash,purpose,payload_json,expires_at,created_at) VALUES(?,?,?,'verify',?,?,?)",
    [crypto.randomUUID(), user.user.id, crypto.randomUUID(), JSON.stringify({ email: "Pending@Example.Test" }),
      "2099-01-01T00:00:00.000Z", app.runtime.clock.now()]);
  for (const recipient of ["OUTSIDER@QUIRE.LOCAL", "verified@example.test", "PENDING@EXAMPLE.TEST", "other@example.test"]) {
    await app.runtime.db.run(
      "INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at) VALUES(?,?,'Private','Private',?,'local',?)",
      [crypto.randomUUID(), recipient, crypto.randomUUID(), app.runtime.clock.now()]);
  }
  const response = await app.request("/api/me", { method: "DELETE", headers: user.headers,
    body: JSON.stringify({ confirmation: user.user.primaryEmail, password, expectedVersion: 0 }) });
  expect(response.status).toBe(200);
  expect(await app.runtime.db.all("SELECT recipient FROM mail_outbox")).toEqual([{ recipient: "other@example.test" }]);
});
