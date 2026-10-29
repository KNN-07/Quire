import type { Migration } from "@quire/runtime";

export const identityProvenanceMigration: Migration = {
  id: "013-a-identity-provenance",
  sql: `
ALTER TABLE identities ADD COLUMN authority_kind TEXT NOT NULL DEFAULT 'legacy'
  CHECK(authority_kind IN ('legacy','personal','organization'));
ALTER TABLE identities ADD COLUMN organization_id TEXT REFERENCES organizations(id)
  CHECK((authority_kind='organization')=(organization_id IS NOT NULL));
CREATE TABLE identity_organization_releases (
  user_id TEXT NOT NULL REFERENCES users(id), organization_id TEXT NOT NULL REFERENCES organizations(id),
  PRIMARY KEY(user_id,organization_id)
) STRICT;
`,
  postgres: `
ALTER TABLE identities ADD COLUMN authority_kind TEXT NOT NULL DEFAULT 'legacy'
  CHECK(authority_kind IN ('legacy','personal','organization'));
ALTER TABLE identities ADD COLUMN organization_id TEXT REFERENCES organizations(id)
  CHECK((authority_kind='organization')=(organization_id IS NOT NULL));
CREATE TABLE identity_organization_releases (
  user_id TEXT NOT NULL REFERENCES users(id), organization_id TEXT NOT NULL REFERENCES organizations(id),
  PRIMARY KEY(user_id,organization_id)
);
`,
};
