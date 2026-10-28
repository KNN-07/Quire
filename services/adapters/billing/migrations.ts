import type { Migration } from "@quire/runtime";

const tables = `
CREATE TABLE billing_merchant_bindings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id), customer_id TEXT NOT NULL UNIQUE,
  subscription_id TEXT UNIQUE, claim TEXT, claim_until TEXT, generation INTEGER NOT NULL DEFAULT 0,
  checkout_id TEXT, checkout_until TEXT
);
CREATE TABLE billing_merchant_quotes (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL, config_version INTEGER NOT NULL,
  price_id TEXT NOT NULL, seats INTEGER NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
  expires_at TEXT NOT NULL, proration_at INTEGER NOT NULL, item_id TEXT, used INTEGER NOT NULL DEFAULT 0,
  request_key TEXT NOT NULL, request_digest TEXT NOT NULL, UNIQUE(actor_id,request_key)
);
CREATE TABLE billing_merchant_receipts (
  actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, digest TEXT NOT NULL,
  operation_json TEXT NOT NULL, request_json TEXT NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id),
  PRIMARY KEY(actor_id,key)
);
CREATE TABLE billing_merchant_documents (
  invoice_id TEXT PRIMARY KEY REFERENCES invoices(id), sha256 TEXT NOT NULL
);
`;
export const migrations: readonly Migration[] = [{
  id: "067-x-billing",
  sql: tables.replaceAll("\n);", "\n) STRICT;"),
  postgres: tables,
}];
