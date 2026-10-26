CREATE TABLE policy_sets (
  id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, policy_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(scope_kind,scope_id)
) STRICT;
CREATE TABLE billing_accounts (
  id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id), user_id TEXT REFERENCES users(id),
  provider TEXT NOT NULL, plan_id TEXT, period TEXT NOT NULL, seats INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, renews_at TEXT, invoice_email TEXT NOT NULL, tax_id TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  CHECK((organization_id IS NOT NULL) != (user_id IS NOT NULL))
) STRICT;
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY, billing_account_id TEXT NOT NULL REFERENCES billing_accounts(id),
  provider_id TEXT UNIQUE, plan_id TEXT NOT NULL, status TEXT NOT NULL, seats INTEGER NOT NULL,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE invoices (
  id TEXT PRIMARY KEY, billing_account_id TEXT NOT NULL REFERENCES billing_accounts(id),
  provider_id TEXT, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
  issued_at TEXT NOT NULL, document_artifact_id TEXT REFERENCES artifacts(id)
) STRICT;
CREATE TABLE webhook_receipts (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, event TEXT NOT NULL, received_at TEXT NOT NULL,
  digest TEXT NOT NULL, UNIQUE(provider,event)
) STRICT;
CREATE TABLE audit_entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id), organization_id TEXT REFERENCES organizations(id), event TEXT NOT NULL,
  target_id TEXT NOT NULL, ip TEXT, details_json TEXT NOT NULL
) STRICT;
CREATE INDEX audit_by_time ON audit_entries(at,event);
CREATE TABLE backups (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, manifest_digest TEXT,
  destination TEXT NOT NULL, verified_at TEXT, operation_id TEXT NOT NULL REFERENCES operations(id)
) STRICT;
CREATE TABLE releases (
  id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, manifest_digest TEXT NOT NULL, notes TEXT NOT NULL,
  signature_verified INTEGER NOT NULL DEFAULT 0, compatible_schema_json TEXT NOT NULL, scheduled_at TEXT
) STRICT;
CREATE TABLE maintenance_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, parameters_json TEXT NOT NULL,
  operation_id TEXT REFERENCES operations(id), created_at TEXT NOT NULL, finished_at TEXT
) STRICT;
CREATE TABLE operator_settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
) STRICT;
