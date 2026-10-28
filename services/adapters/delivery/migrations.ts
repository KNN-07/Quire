import type { Migration } from "@quire/contracts";

export const migrations: readonly Migration[] = [
  {
    id: "062-x-mail-delivery",
    sql: `
CREATE TABLE adapter_mail_deliveries (
  outbox_id TEXT PRIMARY KEY REFERENCES mail_outbox(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','sending','retry','sent','permanent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_id TEXT,
  lease_expires_at TEXT,
  provider_receipt TEXT,
  last_code TEXT,
  last_detail TEXT,
  delivered_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX adapter_mail_delivery_due
  ON adapter_mail_deliveries(provider,state,next_attempt_at,lease_expires_at);
`,
    postgres: `
CREATE TABLE adapter_mail_deliveries (
  outbox_id TEXT PRIMARY KEY REFERENCES mail_outbox(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','sending','retry','sent','permanent')),
  attempts BIGINT NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_id TEXT,
  lease_expires_at TEXT,
  provider_receipt TEXT,
  last_code TEXT,
  last_detail TEXT,
  delivered_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX adapter_mail_delivery_due
  ON adapter_mail_deliveries(provider,state,next_attempt_at,lease_expires_at);
`,
  },
];
