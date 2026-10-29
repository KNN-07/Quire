import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { identityProvenanceMigration } from "../../../services/accounts/identity/identity-provenance-migration";

test("adds provenance without guessing the ownership of existing SQLite identities", () => {
  using db = new Database(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE organizations(id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE identities(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
      issuer TEXT NOT NULL,subject TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(issuer,subject)) STRICT;
    INSERT INTO users VALUES('user');
    INSERT INTO organizations VALUES('team');
    INSERT INTO identities VALUES('personal','user','https://shared.example','personal','2026-10-28');
    INSERT INTO identities VALUES('old-group','user','https://shared.example','group','2026-10-28');`);
  const before = db.query("SELECT id,user_id,issuer,subject,created_at FROM identities ORDER BY id").all();
  db.exec(identityProvenanceMigration.sql);
  expect(db.query("SELECT id,user_id,issuer,subject,created_at FROM identities ORDER BY id").all()).toEqual(before);
  expect(db.query("SELECT authority_kind,organization_id FROM identities").all()).toEqual([
    { authority_kind: "legacy", organization_id: null }, { authority_kind: "legacy", organization_id: null },
  ]);
  expect(() => db.exec("UPDATE identities SET authority_kind='organization' WHERE id='old-group'")).toThrow();
  expect(() => db.exec("UPDATE identities SET authority_kind='personal',organization_id='team' WHERE id='personal'")).toThrow();
  db.exec("UPDATE identities SET authority_kind='organization',organization_id='team' WHERE id='old-group'");
  expect(db.query("SELECT authority_kind,organization_id FROM identities WHERE id='old-group'").get())
    .toEqual({ authority_kind: "organization", organization_id: "team" });
  expect(db.query("SELECT * FROM identity_organization_releases").all()).toEqual([]);
});
