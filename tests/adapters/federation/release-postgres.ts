import { strict as assert } from "node:assert";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { baseFixture } from "../../core/base/harness";
import { postgresFixture } from "../../core/review/postgres-fixture";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { identityProvenanceMigration } from "../../../services/accounts/identity/identity-provenance-migration";

const url = process.env["QUIRE_RELEASE_POSTGRES_URL"];
if (!url) throw new TypeError("QUIRE_RELEASE_POSTGRES_URL must identify an owned disposable PostgreSQL server");
const postgres = await postgresFixture(url);
try {
  await using app = await baseFixture({ createAdapters: postgres.createAdapters });
  assert.equal(app.runtime.db.dialect, "postgres");
  const migration = identityProvenanceMigration.postgres;
  if (!migration) throw new TypeError("PostgreSQL provenance migration missing");
  assert.deepEqual(await app.runtime.db.get("SELECT id,digest FROM schema_migrations WHERE id=?", [identityProvenanceMigration.id]),
    { id: identityProvenanceMigration.id, digest: new Bun.CryptoHasher("sha256").update(migration).digest("hex") });
  const admin = await app.login();
  const user = await app.login("mai@quire.local");
  const write = (path: string, body: unknown, headers: HeadersInit = admin.headers) =>
    app.request(path, { method: "POST", headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(body) });
  assert.equal((await write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 })).status, 200);
  assert.equal((await write(`/api/organizations/${ids.team}/managed/invite`, { userId: ids.mai, expectedVersion: 1 })).status, 200);
  const invitation = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM managed_acceptances WHERE user_id=?", [ids.mai]));
  assert.equal((await write(`/api/managed/${invitation.id}/accept`, { expectedVersion: 0 }, user.headers)).status, 200);
  for (const [subject, kind, organizationId] of [
    ["group", "organization", ids.team], ["personal", "personal", null], ["legacy", "legacy", null],
  ] as const) await app.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at,authority_kind,organization_id) VALUES(?,?,'https://shared.example',?,?,?,?)",
    [crypto.randomUUID(), ids.mai, subject, app.runtime.clock.now(), kind, organizationId]);
  const path = `/api/organizations/${ids.team}/managed/${ids.mai}/release`;
  const before = await app.runtime.db.all("SELECT * FROM identities ORDER BY id");
  assert.equal((await write(path, { expectedVersion: 1 })).status, 409);
  assert.deepEqual(await app.runtime.db.all("SELECT * FROM identities ORDER BY id"), before);
  assert.deepEqual(await app.runtime.db.get("SELECT managed_by,version FROM users WHERE id=?", [ids.mai]), { managed_by: ids.team, version: 1 });
  await app.runtime.db.run("DELETE FROM identities WHERE user_id=? AND subject='legacy'", [ids.mai]);
  assert.equal((await write(path, { expectedVersion: 1 })).status, 409);
  // This core-only assembly may preserve another organization's link, not release an unloaded adapter's authority.
  await app.runtime.db.run("UPDATE identities SET subject='other-organization',organization_id=? WHERE user_id=? AND subject='group'",
    [ids.institution, ids.mai]);
  await app.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [ids.mai, ids.project]);
  const projects = await app.runtime.db.all("SELECT * FROM projects");
  await app.runtime.db.exec(`CREATE FUNCTION fail_release_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='managed.released' THEN RAISE EXCEPTION 'release audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_release_audit BEFORE INSERT ON audit_entries FOR EACH ROW EXECUTE FUNCTION fail_release_audit();`);
  assert.equal((await write(path, { expectedVersion: 1 })).status, 500);
  assert.deepEqual(await app.runtime.db.get("SELECT managed_by,version FROM users WHERE id=?", [ids.mai]), { managed_by: ids.team, version: 1 });
  assert.equal((await app.runtime.db.all("SELECT * FROM identities WHERE user_id=?", [ids.mai])).length, 2);
  assert.equal(await app.runtime.db.get("SELECT user_id FROM identity_organization_releases WHERE user_id=?", [ids.mai]), null);
  await app.runtime.db.exec("DROP TRIGGER fail_release_audit ON audit_entries; DROP FUNCTION fail_release_audit();");
  assert.equal((await write(path, { expectedVersion: 1 })).status, 200);
  assert.equal(await app.runtime.db.get("SELECT id FROM members WHERE user_id=? AND organization_id=?", [ids.mai, ids.team]), null);
  assert.deepEqual(Array.from(await app.runtime.db.all("SELECT subject FROM identities WHERE user_id=? ORDER BY subject", [ids.mai])),
    [{ subject: "other-organization" }, { subject: "personal" }]);
  assert.deepEqual(await app.runtime.db.all("SELECT * FROM projects"), projects);
  assert.equal((await app.request("/api/me", { headers: user.headers })).status, 401);
  assert.equal((await app.login("mai@quire.local")).user.id, ids.mai);
  const receipts = await app.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
  await app.restart();
  assert.deepEqual(await app.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id"), receipts);
  assert.deepEqual(await app.runtime.db.get("SELECT user_id,organization_id FROM identity_organization_releases WHERE user_id=?", [ids.mai]),
    { user_id: ids.mai, organization_id: ids.team });
  console.info("P18_RELEASE_POSTGRES_PASS", { dialect: app.runtime.db.dialect, migration: identityProvenanceMigration.id,
    legacyDenied: true, rollback: true, personalIdentityPreserved: true, independentLogin: true, restart: true, ownedPath: app.path });
} finally { await postgres.close(); }
