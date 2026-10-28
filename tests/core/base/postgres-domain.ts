import { strict as assert } from "node:assert";
import { join } from "node:path";
import { z } from "zod";
import { FileEntrySchema, OperationSchema, ProjectSummarySchema } from "@quire/contracts";
import { DiskBlobStore, LocalBranchCoordinator, LocalRepositoryService, SqliteEventPort } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { baseFixture, projectEnvelope } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

const url = process.env["QUIRE_CORE_BASE_POSTGRES_URL"];
if (!url) throw new Error("QUIRE_CORE_BASE_POSTGRES_URL must name an owned disposable PostgreSQL server");
const name = `quire_base_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = await createPostgresStorage({ url });
const databaseUrl = new URL(url);
databaseUrl.pathname = `/${name}`;
await admin.db.exec(`CREATE DATABASE "${name}"`);
try {
  await using fixture = await baseFixture({
    createAdapters: async (config, clock) => {
      const storage = await createPostgresStorage({ url: databaseUrl.toString() });
      const branches = new LocalBranchCoordinator(storage.uow, clock, config.dataDir);
      const repositories = new LocalRepositoryService(config.dataDir, { ...storage, branches, clock });
      // This EventPort takes the portable executor; this check does not claim Redis delivery.
      const events = new SqliteEventPort(storage.db, clock);
      return {
        ...storage, branches, repositories, events, blobs: new DiskBlobStore(join(config.dataDir, "blobs")),
        close: async () => { await repositories.close(); await branches.close(); await events.close(); await storage.close(); }
      };
    },
  });
  assert.equal(fixture.runtime.db.dialect, "postgres");
  const owner = await fixture.login();
  const headers = { ...owner.headers, "idempotency-key": crypto.randomUUID() };
  const body = JSON.stringify({ name: "PostgreSQL source", origin: { kind: "example" } });
  const first = await fixture.request("/api/projects", { method: "POST", headers, body });
  assert.equal(first.status, 200);
  const project = projectEnvelope.parse(await first.json()).data;
  const scope = { projectId: project.id, branch: "main" };
  assert.equal((await fixture.service.listFiles(scope)).length, 2);
  const list = await fixture.request("/api/projects", { headers: owner.headers });
  const summaries = z.object({ data: z.object({ items: z.array(ProjectSummarySchema) }) }).parse(await list.json());
  assert(summaries.data.items.some(item => item.id === project.id));
  const operator = await fixture.login("operator@quire.local");
  const discovery = await fixture.request("/api/admin/projects", { headers: operator.headers });
  assert.equal(discovery.status, 200);
  const access = await fixture.request(`/api/projects/${project.id}/access?branch=main`, { headers: owner.headers });
  assert.equal(access.status, 200);
  const publish = fixture.runtime.repositories.publish.bind(fixture.runtime.repositories);
  fixture.runtime.repositories.publish = async () => { throw new Error("PostgreSQL crash before repository publication"); };
  const fileHeaders = { ...owner.headers, "idempotency-key": crypto.randomUUID() };
  const fileBody = JSON.stringify({ scope, expectedVersion: 1, path: "recovered.txt", kind: "file", text: "real postgres" });
  try {
    const crashed = await fixture.request(`/api/projects/${project.id}/files`, { method: "POST", headers: fileHeaders, body: fileBody });
    assert.equal(crashed.status, 500);
  } finally { fixture.runtime.repositories.publish = publish; }
  assert.equal((await fixture.runtime.db.all("SELECT id FROM base_source_intents")).length, 1);
  await fixture.restart();
  const recovered = await fixture.request(`/api/projects/${project.id}/files`, { method: "POST", headers: fileHeaders, body: fileBody });
  const file = z.object({ data: FileEntrySchema }).parse(await recovered.json()).data;
  assert.equal((await fixture.service.readDocument(scope, file.id)).text, "real postgres");
  assert.equal((await fixture.service.getBranch(scope)).revision, 2);
  assert.equal((await fixture.runtime.db.all("SELECT id FROM base_source_intents")).length, 0);
  const retried = await fixture.request("/api/projects", { method: "POST", headers, body });
  assert.deepEqual(projectEnvelope.parse(await retried.json()).data, project);
  const exported = await fixture.request(`/api/projects/${project.id}/exports`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ kind: "source" })
  });
  const operation = z.object({ data: OperationSchema }).parse(await exported.json()).data;
  const download = await fixture.request(`/api/operations/${operation.id}/download`, { headers: owner.headers });
  assert.equal(download.status, 200);
  assert(new Uint8Array(await download.arrayBuffer()).length > 0);
  const viewer = await fixture.login("alex@quire.local");
  const forbidden = await fixture.service.authorize(viewer.user.id, { projectId: ids.project, branch: "main" }, "write")
    .then(() => false, () => true);
  assert.equal(forbidden, true);
  const selected = await fixture.runtime.db.all<{ id: string; digest: string }>("SELECT id,digest FROM schema_migrations ORDER BY id");
  console.info("postgres.domain.pass", {
    database: name, dialect: fixture.runtime.db.dialect,
    migrations: selected.length, sourceRevision: 2, projectReplay: true, durableRecovery: true, viewerDenied: true
  });
} finally {
  await admin.db.exec(`DROP DATABASE "${name}"`);
  await admin.close();
  console.info("postgres.database.cleaned", name);
}
