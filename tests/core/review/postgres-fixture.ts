import { join } from "node:path";
import { DiskBlobStore, LocalBranchCoordinator, LocalRepositoryService, SqliteEventPort } from "@quire/runtime";
import type { RuntimeOptions } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";

/** Real PostgreSQL domain testing with native Git/disk blobs and SQL event delivery. */
export async function postgresFixture(url: string) {
  const name = `quire_review_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = await createPostgresStorage({ url });
  const database = new URL(url);
  database.pathname = `/${name}`;
  try { await admin.db.exec(`CREATE DATABASE "${name}"`); }
  catch (error) { await admin.close(); throw error; }
  const createAdapters: NonNullable<RuntimeOptions["createAdapters"]> = async (config, clock) => {
    const storage = await createPostgresStorage({ url: database.toString() });
    const branches = new LocalBranchCoordinator(storage.uow, clock, config.dataDir);
    const repositories = new LocalRepositoryService(config.dataDir, { ...storage, branches, clock });
    const events = new SqliteEventPort(storage.db, clock);
    return {
      ...storage, branches, repositories, events, blobs: new DiskBlobStore(join(config.dataDir, "blobs")),
      close: async () => { await repositories.close(); await branches.close(); await events.close(); await storage.close(); },
    };
  };
  return {
    createAdapters,
    async close() {
      try { await admin.db.exec(`DROP DATABASE "${name}"`); }
      finally { await admin.close(); }
      console.info("P1S_REVIEW_DATABASE_CLEANED", name);
    },
  };
}
