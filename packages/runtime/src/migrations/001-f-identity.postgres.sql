CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('team','institution')), domains_json TEXT NOT NULL DEFAULT '[]',
  policy_json TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, primary_email CITEXT NOT NULL UNIQUE,
  password_hash TEXT, latex_name TEXT NOT NULL DEFAULT '', affiliation TEXT NOT NULL DEFAULT '',
  orcid TEXT, interface_language TEXT NOT NULL DEFAULT 'en' CHECK(interface_language IN ('en','vi','zh')),
  avatar_blob TEXT, managed_by TEXT REFERENCES organizations(id), operator BIGINT NOT NULL DEFAULT 0,
  suspended BIGINT NOT NULL DEFAULT 0, deleted_at TEXT, version BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE verified_emails (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email CITEXT NOT NULL UNIQUE, verified_at TEXT NOT NULL
);
CREATE TABLE identities (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL, subject TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(issuer,subject)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, user_agent TEXT NOT NULL, ip TEXT, version BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE one_time_tokens (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE members (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','member')), licensed BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(organization_id,user_id)
);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY, project_id TEXT,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE, email CITEXT NOT NULL,
  role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  CHECK((project_id IS NOT NULL) != (organization_id IS NOT NULL))
);
CREATE TABLE managed_acceptances (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id), state TEXT NOT NULL,
  accepted_at TEXT, released_at TEXT, version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE(organization_id,user_id)
);
CREATE TABLE institutional_eligibility (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id), basis TEXT NOT NULL, expires_at TEXT, checked_at TEXT NOT NULL,
  UNIQUE(organization_id,user_id)
);
CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, value_json TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE git_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE ssh_keys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, public_key TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
  version BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
