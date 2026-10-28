import { strict as assert } from "node:assert";
import { join } from "node:path";
import { DiskBlobStore, LocalBranchCoordinator, LocalRepositoryService, SqliteEventPort } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { catalogFixture, bib, entryEnvelope, templateEnvelope, projectEnvelope } from "./harness";
import { catalogConcurrency } from "./concurrency";
import { fixtureIds } from "../../fixtures/foundation";

const url = process.env["QUIRE_CATALOG_POSTGRES_URL"];
if (!url) throw new Error("QUIRE_CATALOG_POSTGRES_URL must name an owned disposable PostgreSQL server");
const name = `quire_catalog_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = await createPostgresStorage({ url });
const databaseUrl = new URL(url);
databaseUrl.pathname = `/${name}`;
await admin.db.exec(`CREATE DATABASE "${name}"`);
try {
  await using fixture = await catalogFixture({
    createAdapters: async (config, clock) => {
      const storage = await createPostgresStorage({ url: databaseUrl.toString() });
      const branches = new LocalBranchCoordinator(storage.uow, clock, config.dataDir);
      const repositories = new LocalRepositoryService(config.dataDir, { ...storage, branches, clock });
      const events = new SqliteEventPort(storage.db, clock);
      return {
        ...storage, branches, repositories, events, blobs: new DiskBlobStore(join(config.dataDir, "blobs")),
        close: async () => { await repositories.close(); await branches.close(); await events.close(); await storage.close(); },
      };
    },
  });
  assert.equal(fixture.runtime.db.dialect, "postgres");
  await catalogConcurrency(fixture);
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const operator = await fixture.login("operator@quire.local");
  const headers = { ...owner.headers, "idempotency-key": crypto.randomUUID() };
  const createEntry = () => fixture.request("/api/me/library", {
    method: "POST", headers, body: JSON.stringify({ bibtex: bib, origin: "manual" }),
  });
  const entry = entryEnvelope.parse(await (await createEntry()).json()).data;
  await fixture.restart();
  assert.deepEqual(entryEnvelope.parse(await (await createEntry()).json()).data, entry);
  let version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Private approved PostgreSQL", category: "", description: "", license: "MIT",
    visibility: "private", sourceProjectId: fixtureIds.project,
  })).json()).data;
  const submit = await fixture.mutate(`/api/templates/${version.templateId}/submit`, owner.headers, { expectedVersion: version.version });
  version = templateEnvelope.parse(await submit.json()).data;
  assert.equal((await fixture.request(`/api/templates/${version.templateId}`, { headers: outsider.headers })).status, 404);
  assert.equal((await fixture.request("/api/admin/templates", { headers: operator.headers })).status, 200);
  const approve = await fixture.mutate(`/api/templates/${version.templateId}/approve`, operator.headers, {
    expectedVersion: version.version, versionId: version.id,
  });
  version = templateEnvelope.parse(await approve.json()).data;
  const copy = await fixture.mutate("/api/projects", owner.headers, {
    name: "Approved exact PostgreSQL copy", origin: { kind: "template", templateVersionId: version.id },
  });
  assert.equal(copy.status, 200);
  const copied = projectEnvelope.parse(await copy.json()).data;
  assert.equal((await fixture.service.listFiles({ projectId: copied.id, branch: "main" })).length,
    (await fixture.service.readSnapshot(version.snapshotId)).files.length);
  console.info("catalog.postgres.pass", name, "receipt restart, private gallery, operator discovery, approved exact copy");
} finally {
  await admin.db.exec(`DROP DATABASE "${name}"`);
  await admin.close();
  console.info("catalog.postgres.database.cleaned", name);
}
