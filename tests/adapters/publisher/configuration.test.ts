import { expect, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import { Database } from "bun:sqlite";
import { migrations as sharedMigrations } from "../../../services/adapters/shared";
import type { ProviderSettings } from "../../../services/adapters/shared";
import {
  migrations,
  publisherRequirements,
} from "../../../services/adapters/publisher";
import { defaultPolicy } from "../../fixtures/foundation";

test("names every missing publisher prerequisite when unconfigured", () => {
  // Given
  const settings: ProviderSettings = {
    id: IdSchema.parse("00000000-0000-4000-8000-000000000066"),
    kind: "publisher",
    baseUrl: "",
    secret: null,
    enabled: false,
    policy: defaultPolicy,
    version: 0,
  };
  // When
  const missing = publisherRequirements(settings);
  // Then
  expect(missing).toEqual([
    "publisher destination API base URL",
    "valid publisher destination contract mapping in publisherContract or legacy model JSON",
  ]);
});

test("rejects an invalid private destination mapping without inventing endpoints", () => {
  // Given
  const settings: ProviderSettings = {
    id: IdSchema.parse("00000000-0000-4000-8000-000000000067"),
    kind: "publisher",
    baseUrl: "https://publisher.invalid",
    model: JSON.stringify({
      version: 1,
      mode: "direct",
      credentialTestPath: "api/me",
    }),
    secret: "configured",
    enabled: true,
    policy: defaultPolicy,
    version: 1,
  };
  // When
  const missing = publisherRequirements(settings);
  // Then
  expect(missing).toEqual([
    "valid publisher destination contract mapping in publisherContract or legacy model JSON",
  ]);
});

test("ships explicit SQLite and PostgreSQL publisher migration variants", () => {
  // Given
  const migration = migrations[0];
  if (!migration) throw new TypeError("Publisher migration missing");
  // When
  const sqliteDigest = new Bun.CryptoHasher("sha256").update(migration.sql).digest("hex");
  const postgres = migration.postgres;
  // Then
  expect(migration.id).toBe("066-x-publisher");
  expect(sqliteDigest).toHaveLength(64);
  expect(postgres).toContain("CREATE TABLE publisher_submissions");
  expect(postgres).not.toBe(migration.sql);
});

test("typed configuration migration preserves an existing model-only row", () => {
  using db = new Database(":memory:");
  const initial = sharedMigrations.find(migration => migration.id === "060-x-shared-adapters");
  const delta = sharedMigrations.find(migration => migration.id === "060-x-shared-publisher-contract");
  if (!initial || !delta) throw new TypeError("Shared migration missing");
  db.exec(initial.sql);
  db.run(`INSERT INTO adapter_provider_configs
    (id,kind,base_url,model,policy_json,version,updated_at) VALUES(?,?,?,?,?,7,?)`,
  ["legacy", "publisher", "https://publisher.invalid", '{"version":1}', "{}", "2026-11-13"]);
  db.exec(delta.sql);
  expect(db.query("SELECT model,version,publisher_contract_json FROM adapter_provider_configs").get())
    .toEqual({ model: '{"version":1}', version: 7, publisher_contract_json: null });
  expect(delta.postgres).toBe("ALTER TABLE adapter_provider_configs ADD COLUMN publisher_contract_json TEXT;");
});
