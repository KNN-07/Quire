import { foundationMigrations, migrationSql } from "@quire/runtime";
import { modules } from "../../apps/server/src/composition";
import { createPostgresStorage } from "../../services/operations/storage/postgres";
import { ArtifactError } from "./artifacts";

/** Checks every selected migration digest without applying migrations or starting producers. */
export async function schemaReady(): Promise<void> {
  const storage = await createPostgresStorage({ url: process.env["QUIRE_POSTGRES_URL"] ?? "" });
  try {
    for (const migration of [...await foundationMigrations(), ...modules.flatMap(module => module.migrations ?? [])]) {
      const expected = new Bun.CryptoHasher("sha256").update(migrationSql(migration, "postgres")).digest("hex");
      const row = await storage.db.get<{ digest: string }>("SELECT digest FROM schema_migrations WHERE id=?", [migration.id]);
      if (row?.digest !== expected) throw new ArtifactError("SCHEMA_NOT_READY", migration.id);
    }
  } finally { await storage.close(); }
}
if (import.meta.main) await schemaReady();
