import { createLocalAdapters, createRuntime, loadConfig, migrateDatabase, prepareData, systemClock } from "@quire/runtime";
import { createPostgresStorage } from "../services/operations/storage/postgres";
import { applicationMigrations } from "../apps/server/src/migrations";
import { createScaleAdapters } from "../apps/server/src/scale";
import { transferQuiesced } from "../apps/server/src/transfer";
import { assertUncontrolledEntrypoint } from "../services/operations/installation/launch";

/** Schema-only startup deliberately does not register producers or contact Git. */
export async function migrate(): Promise<void> {
  await assertUncontrolledEntrypoint();
  const config = loadConfig();
  await prepareData(config);
  const storage = config.profile === "scale"
    ? await createPostgresStorage({ url: process.env["QUIRE_POSTGRES_URL"] ?? "" })
    : await createLocalAdapters(config, systemClock);
  try {
    await migrateDatabase(storage.uow, await applicationMigrations());
    console.info("db.migrated", { profile: config.profile, database: storage.db.dialect });
  } finally { await storage.close(); }
}
if (import.meta.main) {
  await migrate();
  const sourceDir = process.env["QUIRE_TRANSFER_SOURCE"];
  if (sourceDir) {
    const foundation = await applicationMigrations();
    const source = await createRuntime(loadConfig({ ...process.env, QUIRE_PROFILE: "local", QUIRE_DATA_DIR: sourceDir }), { foundation });
    try {
      const target = await createRuntime(loadConfig(), { foundation, createAdapters: createScaleAdapters });
      try {
        console.info("db.transferred", JSON.stringify(await transferQuiesced(source, target,
          process.argv.includes("--quiesced"))));
      } finally { await target.close(); }
    } finally { await source.close(); }
  }
}
