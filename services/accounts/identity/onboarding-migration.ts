import type { Migration } from "@quire/runtime";

const table = `
CREATE TABLE identity_onboarding (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  value_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`;
export const onboardingMigration: Migration = {
  id: "013-a-onboarding",
  sql: `${table} STRICT;`,
  postgres: `${table};`,
};
