import { strict as assert } from "node:assert";
import { join } from "node:path";
import { DiskBlobStore, LocalBranchCoordinator, LocalRepositoryService, SqliteEventPort } from "@quire/runtime";
import { createPostgresStorage } from "../../services/operations/storage/postgres";
import { compilerHttp } from "./http-fixture";
import { portableCompilerDomain } from "./portable-domain";

const url = process.env["QUIRE_COMPILER_POSTGRES_URL"];
if (!url) throw new Error("QUIRE_COMPILER_POSTGRES_URL must name an owned disposable PostgreSQL server");
const name = `quire_compiler_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = await createPostgresStorage({ url });
const databaseUrl = new URL(url);
databaseUrl.pathname = `/${name}`;
await admin.db.exec(`CREATE DATABASE "${name}"`);
try {
  await using app = await compilerHttp({
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
  assert.equal(app.runtime.db.dialect, "postgres");
  await portableCompilerDomain(app);
  console.info("compiler.postgres.domain.pass", { database: name, migrations: await app.runtime.db.all("SELECT id FROM schema_migrations ORDER BY id") });
} finally {
  await admin.db.exec(`DROP DATABASE "${name}"`);
  await admin.close();
  console.info("compiler.postgres.database.cleaned", name);
}
