import { expect, test } from "bun:test";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { z } from "zod";
import { zipSync } from "fflate";
import { AdapterGrantSchema, CapabilitySchema, FileEntrySchema, IdSchema, OperationSchema, ProjectSchema } from "@quire/contracts";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { createApplicationAdapters } from "../../../services/adapters";
import { referenceProvider, zoteroKey } from "../../adapters/references/provider";
import { providerServer } from "../../adapters/ai/provider";
import { stripeFixture } from "../../adapters/billing/provider";
import { providerFixture } from "../../adapters/federation/oidc-idp";
import { topology } from "../portable/topology";
import { bounded } from "../portable/process";
import { AdapterApi } from "./api-host";
import { data } from "./harness";
import { admitScaleFederation, reconcileScaleBilling, reviewScaleAi } from "./scale-workflows";

test("publishes real adapter workflows across two API processes using PostgreSQL Redis S3 and singleton Git", async () => {
  // Given: actual infrastructure and protocol-faithful external providers.
  await using references = referenceProvider();
  await using ai = providerServer();
  await using stripe = stripeFixture();
  await using oidc = await providerFixture();
  await using infrastructure = await topology();
  const environment = { ...infrastructure.env,
    QUIRE_TEST_FIXTURE_ORIGINS: JSON.stringify([references.origin, ai.origin, stripe.origin, oidc.origin]),
    QUIRE_BACKUP_ROOT: join(infrastructure.root, "shared-backups"),
    QUIRE_BACKUP_SIGNING_FIXTURE_PEM: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }),
  };
  await using first = new AdapterApi({ ...environment, QUIRE_DATA_DIR: join(infrastructure.root, "adapter-a"), QUIRE_TEST_SEED: "1" });
  await first.ready;
  await using second = new AdapterApi({ ...environment, QUIRE_DATA_DIR: join(infrastructure.root, "adapter-b") });
  await second.ready;
  expect((await data(await second.request("/api/health"), z.object({ database: z.string() }))).database).toBe("postgres");
  const session = await first.login();
  const operator = await first.login("operator@quire.local");
  for (const [kind, settings] of [
    ["zotero", { baseUrl: references.origin }],
    ["ai", { baseUrl: `${ai.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key" }],
    ["stripe-billing", { baseUrl: stripe.origin, secret: JSON.stringify({
      apiKey: "sk_test_fixture", webhookSecrets: ["whsec_fixture"], portalConfiguration: "bpc_fixture",
      prices: [{ id: "price_month", name: "Monthly fixture" }, { id: "price_year", name: "Annual fixture" }],
    }) }],
  ] as const) {
    const configured = await first.request(`/api/admin/providers/${kind}`, {
      method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
      body: JSON.stringify({ ...settings, expectedVersion: 0, policy: { ...defaultPolicy, ai: "agent" } }),
    });
    expect(configured.status).toBe(200);
  }
  const grant = await data(await first.request("/api/connections/zotero/credentials", {
    method: "POST", headers: session.headers, body: JSON.stringify({ accessToken: zoteroKey, label: "Shared PostgreSQL grant" }),
  }), AdapterGrantSchema);
  // When: one API admits work and the other reads/tests/publishes using shared authority.
  const availability = await data(await second.request("/api/connections/availability", { headers: session.headers }),
    z.record(z.string(), CapabilitySchema));
  expect(availability["zotero"]?.state).toBe("ready");
  expect((await second.request(`/api/connections/${grant.id}/test`, {
    method: "POST", headers: session.headers, body: JSON.stringify({ expectedVersion: grant.version }),
  })).status).toBe(200);
  const actionKey = crypto.randomUUID();
  const syncBody = JSON.stringify({ action: "librarySync", expectedVersion: grant.version, expectedCursor: null,
    parameters: { selection: { libraryType: "users", libraryId: "123", collectionKey: "ABCD1234" } } });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  references.state.onRequest = async () => { entered.resolve(); await release.promise; };
  const admitted = second.request(`/api/connections/${grant.id}/actions`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": actionKey }, body: syncBody,
  });
  try {
    await bounded(entered.promise, 20_000);
    const competing = await first.request(`/api/connections/${grant.id}/actions`, {
      method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() }, body: syncBody,
    });
    expect(competing.status).toBe(409);
    expect(z.object({ error: z.object({ code: z.string() }) }).parse(await competing.json()).error.code).toBe("GRANT_BUSY");
  } finally { release.resolve(); }
  const synced = await data(await admitted, OperationSchema);
  const calls = references.state.requests.length;
  expect(await data(await first.request(`/api/connections/${grant.id}/actions`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": actionKey }, body: syncBody,
  }), OperationSchema)).toEqual(synced);
  expect(references.state.requests).toHaveLength(calls);
  const discovered = await data(await first.request(`/api/connections/${grant.id}/cursor?action=librarySync`,
    { headers: session.headers }), z.object({ cursor: z.string().nullable(), grantVersion: z.number() }));
  expect(discovered).toEqual({ cursor: String(references.state.version), grantVersion: grant.version });
  const source = "\\documentclass{article}\n\\begin{document}Scale imported bytes\\end{document}\n";
  const archive = zipSync({ "main.tex": new TextEncoder().encode(source), "source.bin": new Uint8Array([0, 255, 37, 81]) });
  const form = new FormData();
  form.set("kind", "zip"); form.set("name", "Scale import"); form.set("source", new File([archive], "scale.zip"));
  const imported = await data(await first.request("/api/imports", { method: "POST",
    headers: { ...session.headers, "idempotency-key": crypto.randomUUID() }, body: form }), OperationSchema);
  const [projectId] = z.object({ projectIds: z.array(IdSchema) }).parse(imported.result).projectIds;
  if (!projectId) throw new TypeError("Scale import missing");
  const project = await data(await second.request(`/api/projects/${projectId}?branch=main`, { headers: session.headers }), ProjectSchema);
  const files = await data(await second.request(`/api/projects/${projectId}/files?branch=main`, { headers: session.headers }), z.array(FileEntrySchema));
  const binary = files.find(file => file.path === "source.bin");
  if (!binary) throw new TypeError("Scale binary missing");
  expect(new Uint8Array(await (await second.request(`/api/projects/${projectId}/files/${binary.id}/content?branch=main`,
    { headers: session.headers })).arrayBuffer())).toEqual(new Uint8Array([0, 255, 37, 81]));
  await reviewScaleAi([first, second], { project, provider: ai, storage: infrastructure.storage });
  await reconcileScaleBilling([first, second], stripe);
  await admitScaleFederation([first, second], oidc);
  // Then: authoritative SQL has one verified webhook receipt, portable migrations and real source publications.
  expect(await infrastructure.storage.db.all("SELECT event FROM webhook_receipts")).toHaveLength(1);
  const migrations = await infrastructure.storage.db.all<{ id: string; digest: string }>("SELECT id,digest FROM schema_migrations ORDER BY id");
  const inventory = createApplicationAdapters({});
  try {
    for (const migration of inventory.modules.flatMap(module => module.migrations ?? [])) {
      if (!migration.postgres) throw new TypeError(`PostgreSQL variant missing: ${migration.id}`);
      expect(migrations.find(row => row.id === migration.id)?.digest)
        .toBe(new Bun.CryptoHasher("sha256").update(migration.postgres).digest("hex"));
    }
  } finally { await inventory.close(); }
  console.info("ADAPTER_SCALE_VERIFIED", { apiPids: [first.child.pid, second.child.pid],
    profile: "postgres/redis/s3/singleton-git", projectId, grantId: grant.id, migrations: migrations.length });
}, 300_000);
