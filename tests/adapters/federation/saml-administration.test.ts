import { expect, test } from "bun:test";
import { z } from "zod";
import { resultSchema, IdSchema } from "@quire/contracts";
import { samlAdministrationEndpoints as endpoints } from "../../../packages/contracts/src/routes-saml-administration";
import { fixture } from "./harness";
import { certificate, authnRequestId, signedResponse } from "./signed-idp";
import { FederationSaml } from "../../../services/adapters/federation";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("SAML administration scopes reminders, unlink and atomic bulk recovery with session and callback fences", async () => {
  await using app = await fixture();
  await using signer = await certificate();
  let admin = await app.login();
  const member = await app.login("mai@quire.local");
  const outsider = await app.login("sam@quire.local");
  await app.runtime.db.run(`INSERT INTO members(id,organization_id,user_id,role,licensed,created_at)
    VALUES(?,?,?,'member',0,?)`, [crypto.randomUUID(), ids.institution, ids.mai, app.context.clock.now()]);
  const current = await app.configurations.get();
  await app.runtime.uow.run(tx => app.configurations.save(tx, { ...current, config: { ...current.config,
    protocol: "saml", saml: { entityId: "https://idp.example.test", ssoUrl: `${app.provider.origin}/saml`, certificates: [signer.cert], metadataXml: "" } } }));
  const base = `/api/organizations/${ids.institution}/saml-links`;
  async function view() {
    const response = await app.request(base, { headers: admin.headers });
    expect(response.status).toBe(200);
    const result = resultSchema(endpoints.samlLinks.output).parse(await response.json());
    if ("error" in result) throw new Error(result.error.message);
    return result.data;
  }
  async function command(action: "remind" | "unlink" | "unlink-all", userId?: string,
    headers = admin.headers, snapshot?: Awaited<ReturnType<typeof view>>, key = crypto.randomUUID()) {
    const state = snapshot ?? await view();
    return app.request(base, { method: "POST", headers: { ...headers, "idempotency-key": key },
      body: JSON.stringify({ action, ...(userId ? { userId } : {}), expectedVersion: state.version, snapshot: state.snapshot }) });
  }
  async function begin(actor = member) {
    const row = z.object({ version: z.number() }).parse(await app.runtime.db.get("SELECT version FROM users WHERE id=?", [actor.user.id]));
    const response = await app.request("/api/me/identities/saml/link", { method: "POST",
      headers: actor.headers, body: JSON.stringify({ expectedVersion: row.version }) });
    expect(response.status).toBe(200);
    const location = response.headers.get("location");
    if (!location) throw new Error(await response.text());
    const protocol = new FederationSaml(app.context);
    return { cookie: `${actor.cookie}; ${response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ")}`,
      relay: new URL(location).searchParams.get("RelayState") ?? "",
      proof: { requestId: authnRequestId(location), issuer: "https://idp.example.test",
        audience: protocol.spIssuer, destination: protocol.callbackUrl } };
  }
  async function finish(state: Awaited<ReturnType<typeof begin>>, subject: string) {
    return app.request("/api/auth/saml/acs", { method: "POST",
      headers: { cookie: state.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ RelayState: state.relay, SAMLResponse: signedResponse({ ...state.proof, ...signer, subject }) }).toString() });
  }
  // Independent members cannot administer links; reminders are local and replay once.
  expect((await app.request(base, { headers: member.headers })).status).toBe(403);
  const reminder = await view();
  const key = crypto.randomUUID();
  expect((await command("remind", ids.mai, admin.headers, reminder, key)).status).toBe(200);
  expect((await command("remind", ids.mai, admin.headers, reminder, key)).status).toBe(200);
  expect(await app.runtime.db.all("SELECT status FROM mail_outbox WHERE subject='Link your institutional SAML identity'")).toEqual([{ status: "local" }]);
  expect((await command("remind", ids.sam, admin.headers, reminder, key)).status).toBe(409);
  await app.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [ids.operator]);
  expect((await command("remind", ids.mai, admin.headers, reminder, key)).status).toBe(403);
  await app.runtime.db.run("UPDATE users SET operator=1 WHERE id=?", [ids.operator]);
  expect((await command("unlink", ids.mai, member.headers)).status).toBe(403);
  expect((await command("unlink", ids.mai, { cookie: admin.cookie, "x-csrf-token": "wrong" })).status).toBe(403);
  expect((await command("remind", ids.sam)).status).toBe(404);
  const first = await finish(await begin(), "mai-original");
  expect(first.status).toBe(303);
  const samlCookie = first.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  expect((await view()).items.find(item => item.userId === ids.mai)?.linked).toBe(true);
  const memberAgain = await app.login("mai@quire.local");
  const pending = await begin(memberAgain);
  const stale = await view();
  await app.runtime.db.run(`INSERT INTO members(id,organization_id,user_id,role,licensed,created_at)
    VALUES(?,?,?,'member',0,?)`, [crypto.randomUUID(), ids.institution, ids.kien, app.context.clock.now()]);
  expect((await finish(await begin(await app.login("kien@quire.local")), "kien-original")).status).toBe(303);
  // Losing independent recovery aborts the whole bulk operation.
  const password = z.object({ password_hash: z.string() }).parse(await app.runtime.db.get("SELECT password_hash FROM users WHERE id=?", [ids.mai]));
  await app.runtime.db.run("UPDATE users SET password_hash=NULL WHERE id=?", [ids.mai]);
  expect((await command("unlink-all")).status).toBe(409);
  expect((await view()).items.filter(item => item.linked)).toHaveLength(2);
  await app.runtime.db.run("UPDATE users SET password_hash=? WHERE id=?", [password.password_hash, ids.mai]);
  const personalId = IdSchema.parse(crypto.randomUUID());
  await app.runtime.db.run(`INSERT INTO identities(id,user_id,issuer,subject,created_at,authority_kind)
    VALUES(?,?,?,?,?,'personal')`, [personalId, ids.mai, "https://personal.invalid", "personal", app.context.clock.now()]);
  const foreignId = IdSchema.parse(crypto.randomUUID());
  await app.runtime.db.run(`INSERT INTO identities(id,user_id,issuer,subject,created_at,authority_kind,organization_id)
    VALUES(?,?,?,?,?,'organization',?)`, [foreignId, ids.mai, "https://idp.example.test", "foreign-org", app.context.clock.now(), ids.team]);
  await app.runtime.db.run("INSERT INTO federation_saml_links(identity_id) VALUES(?)", [foreignId]);
  expect((await command("unlink", ids.mai)).status).toBe(200);
  expect((await app.request("/api/me", { headers: { cookie: samlCookie } })).status).toBe(401);
  const fenced = await finish(pending, "mai-pending");
  expect(fenced.status).toBe(400);
  expect(await fenced.text()).toContain("OAUTH_STATE_INVALID");
  expect((await command("remind", ids.mai, admin.headers, stale)).status).toBe(409);
  expect(await app.runtime.db.get("SELECT id FROM identities WHERE id=?", [personalId])).not.toBeNull();
  expect(await app.runtime.db.get("SELECT id FROM identities WHERE id=?", [foreignId])).not.toBeNull();
  expect(await app.runtime.db.get("SELECT id FROM users WHERE id=?", [ids.mai])).not.toBeNull();
  // Relink a changed identifier using the preserved independent login.
  const recovered = await app.login("mai@quire.local");
  expect((await finish(await begin(recovered), "mai-new")).status).toBe(303);
  // Managed links require the narrow admin grant, not ordinary self-link authority.
  await app.runtime.db.run("UPDATE users SET managed_by=? WHERE id=?", [ids.institution, ids.mai]);
  await app.runtime.db.run(`INSERT INTO managed_acceptances(id,organization_id,user_id,state,created_at)
    VALUES(?,?,?,'accepted',?)`, [crypto.randomUUID(), ids.institution, ids.mai, app.context.clock.now()]);
  const managed = await app.login("mai@quire.local");
  expect((await finish(await begin(managed), "mai-forbidden")).status).toBe(403);
  expect((await command("unlink-all")).status).toBe(200);
  expect(await app.runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.mai])).toEqual({ managed_by: ids.institution });
  const managedRecovery = await app.login("mai@quire.local");
  expect((await finish(await begin(managedRecovery), "mai-managed-new")).status).toBe(303);
  expect(await app.runtime.db.get("SELECT user_id FROM federation_saml_relinks WHERE user_id=?", [ids.mai])).toBeNull();
  expect((await command("unlink-all")).status).toBe(200);
  await app.runtime.db.run("INSERT INTO identity_organization_releases(user_id,organization_id) VALUES(?,?)", [ids.mai, ids.institution]);
  const released = await app.login("mai@quire.local");
  expect((await finish(await begin(released), "mai-released")).status).toBe(409);
  expect(await app.runtime.db.get("SELECT user_id FROM federation_saml_relinks WHERE user_id=?", [ids.mai])).not.toBeNull();
  // A foreign organization is never admitted by operator status alone.
  const foreign = await app.request(`/api/organizations/${ids.team}/saml-links`, { method: "POST",
    headers: { ...admin.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ action: "remind", userId: outsider.user.id, expectedVersion: 0, snapshot: "" }) });
  expect(foreign.status).toBe(409);
  await app.runtime.db.run("UPDATE members SET role='admin' WHERE organization_id=? AND user_id=?", [ids.institution, ids.kien]);
  admin = await app.login("kien@quire.local");
  expect((await finish(await begin(admin), "administrator-self")).status).toBe(303);
  admin = await app.login("kien@quire.local");
  const self = await command("unlink", ids.kien);
  expect(self.status).toBe(200);
  expect(await self.json()).toMatchObject({ data: { signedOut: true } });
  expect((await app.request("/api/me", { headers: admin.headers })).status).toBe(401);
  admin = await app.login("kien@quire.local");
  app.provider.state.now += 901_000;
  expect((await command("remind", ids.mai)).status).toBe(403);
}, 120_000);
