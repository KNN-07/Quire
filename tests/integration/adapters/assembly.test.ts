import { expect, test } from "bun:test";
import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { CapabilitySchema } from "@quire/contracts";
import { createApplicationAdapters, loadAdapterDeployment } from "../../../services/adapters";
import { integrationFixture, data } from "./harness";

test("exposes honest installed capabilities with no external credentials and retains them after restart", async () => {
  // Given
  await using fixture = await integrationFixture();
  const session = await fixture.login();
  const schema = z.record(z.string(), CapabilitySchema);
  const before = await fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
  // When
  const availability = await data(await fixture.request("/api/connections/availability", { headers: session.headers }), schema);
  await fixture.restart();
  // Then
  expect(availability["localMail"]?.state).toBe("ready");
  expect(availability["ai"]?.state).toBe("unconfigured");
  expect(availability["git"]?.state).toBe("unconfigured");
  expect(availability["readcube"]?.state).toBe("unconfigured");
  expect(Object.keys(availability).sort()).toEqual([
    "ai", "arxiv", "crossref", "dimensions", "doi", "dropbox", "git", "github", "gitlab",
    "identity-github", "identity-google", "identity-orcid", "localMail", "mendeley", "publisher",
    "readcube", "semanticScholar", "smtp", "stripe-billing", "zotero",
  ]);
  expect(await data(await fixture.request("/api/connections/availability", { headers: session.headers }), schema)).toEqual(availability);
  expect(await fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")).toEqual(before);
  expect((await fixture.request("/api/connections/availability")).status).toBe(401);
}, 90_000);

test("keeps every adapter migration explicitly portable and each route singly registered", async () => {
  // Given
  await using fixture = await integrationFixture();
  // When
  const inventory = fixture.adapters.modules.flatMap(module => module.migrations ?? []);
  // Then
  expect(new Set(inventory.map(migration => migration.id)).size).toBe(inventory.length);
  for (const migration of inventory) {
    expect(migration.sql.length).toBeGreaterThan(0);
    expect(migration.postgres?.length).toBeGreaterThan(0);
  }
  expect(fixture.adapters.modules.find(module => module.id === "067-x-billing")?.lane).toBe("A");
  expect(fixture.adapters.modules.find(module => module.id === "067-o-federation-admin")?.lane).toBe("O");
  expect((await fixture.request("/api/billing/catalog")).status).toBe(200);
  expect((await fixture.request("/api/admin/identity")).status).not.toBe(501);
}, 90_000);

test("starts and closes a fresh host lifecycle idempotently without provider traffic", async () => {
  // Given
  await using fixture = await integrationFixture();
  // When
  await fixture.start();
  await fixture.start();
  await fixture.adapters.close();
  await fixture.adapters.close();
  // Then
  let closed: unknown;
  try { fixture.adapters.start(); }
  catch (error) { if (!(error instanceof ServiceError)) throw error; closed = error; }
  expect(closed).toMatchObject({ code: "ADAPTERS_CLOSED" });
  expect((await fixture.request("/api/auth/options")).status).toBe(200);
}, 90_000);

test("rejects invalid deployment configuration before any runtime resource is acquired", async () => {
  // Given
  const env = { QUIRE_ADAPTER_SCHEDULER_INTERVAL_MS: "0" };
  // When / Then
  expect(() => loadAdapterDeployment(env)).toThrow(z.ZodError);
  const factory = createApplicationAdapters({});
  let unregistered: unknown;
  try { factory.start(); }
  catch (error) { if (!(error instanceof ServiceError)) throw error; unregistered = error; }
  expect(unregistered).toMatchObject({ code: "ADAPTERS_UNREGISTERED" });
  await factory.close();
});
