import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, UserSchema } from "@quire/contracts";
import { createRuntime } from "@quire/runtime";
import { register, migrations } from "../../../services/accounts/identity";
import { fixture } from "./harness";

test("signs in an already linked ORCID subject without inventing an email claim", async () => {
  // Given: ORCID was explicitly linked to a verified local account.
  await using app = await fixture();
  const local = await app.login();
  const linkStart = await app.request("/api/me/identities/orcid/link", { method: "POST", headers: local.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  const linked = await app.authorize(linkStart);
  expect((await app.request(linked.path, { headers: { cookie: `${local.cookie}; ${linked.cookie}` } })).status).toBe(303);
  const started = await app.begin("orcid");
  // When: the researcher signs in again through ORCID alone.
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  // Then: the existing local account and verified address are retained.
  expect(response.status).toBe(303);
  const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith("quire_session="))?.split(";")[0] ?? "";
  const me = z.object({ data: z.object({ user: UserSchema }) }).parse(await (await app.request("/api/me", { headers: { cookie } })).json());
  expect(me.data.user.id).toBe(local.user.id);
  expect(me.data.user.verifiedEmails).toEqual(["kien@quire.local"]);
});

test("reads an issued external session from a fresh runtime with the original encryption key", async () => {
  // Given: an external login was committed by the original API instance.
  await using app = await fixture();
  const started = await app.begin();
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith("quire_session="))?.split(";")[0] ?? "";
  const identity = z.object({ user_id: IdSchema }).parse(await app.runtime.db.get("SELECT user_id FROM identities"));
  // When: a newly constructed runtime reads the same durable store and key.
  const reopened = await createRuntime(app.runtime.config, { clock: app.runtime.clock,
    modules: [{ id: "010-a-identity", lane: "A", order: 10, register, migrations }] });
  try {
    const principal = await reopened.services.get("identity").require(new Request("http://localhost/", { headers: { cookie } }));
    // Then: authentication is durable, not in an adapter-local memory map.
    expect(principal.user.id).toBe(identity.user_id);
    expect(principal.user.primaryEmail).toBe("external@example.test");
  } finally { await reopened.close(); }
});

test("denies a suspended linked account after valid provider authentication", async () => {
  // Given: an external subject belongs to a suspended account.
  await using app = await fixture();
  const local = await app.login();
  await app.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)",
    [crypto.randomUUID(), local.user.id, app.provider.origin, "subject-one", app.runtime.clock.now()]);
  await app.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [local.user.id]);
  const started = await app.begin();
  // When: that valid subject signs in again.
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  // Then: provider authentication cannot override the account's suspension.
  expect(response.status).toBe(401);
  expect(response.headers.getSetCookie().some((entry) => entry.startsWith("quire_session="))).toBe(false);
});
