import { expect, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
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
    "publisher OAuth client secret",
    "publisher destination contract mapping in model JSON",
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
    "valid publisher destination contract mapping in model JSON",
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
