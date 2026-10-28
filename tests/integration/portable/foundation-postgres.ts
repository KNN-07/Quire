import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { foundationMigrations, migrationSql } from "../../../packages/runtime/src/database";

// Run against a ready, task-owned PostgreSQL container. Each run owns its database.
const container = z.string().regex(/^quire-[a-z0-9-]+$/,
  "Set QUIRE_FOUNDATION_CONTAINER to an owned quire-* container").parse(process.env["QUIRE_FOUNDATION_CONTAINER"]);
const database = `quire_foundation_${crypto.randomUUID().replaceAll("-", "")}`;
const migrations = await foundationMigrations();
const local = new Database(":memory:", { strict: true });
local.exec("PRAGMA foreign_keys=ON");
for (const migration of migrations) local.exec(migration.sql);

async function psql(sql: string, target = database): Promise<string> {
  const child = Bun.spawn(["docker", "exec", "-i", container, "psql", "-X", "-qAt",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", target], {
    stdin: new Blob([sql]), stdout: "pipe", stderr: "pipe",
  });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(`psql exited ${code}: ${error}`);
  return output.trim();
}

await psql(`CREATE DATABASE ${database}`, "postgres");
try {
  await psql(`BEGIN;\n${migrations.map(migration => migrationSql(migration, "postgres")).join("\n")}\nCOMMIT;`);
  const nativeNames = z.array(z.object({ name: z.string() })).parse(local.query(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all())
    .map(row => row.name);
  const pgNames = z.array(z.string()).parse(JSON.parse(await psql(
    "SELECT json_agg(table_name ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public'")));
  assert.deepEqual(pgNames, nativeNames);

  const nativeColumns = nativeNames.flatMap(table => z.array(z.object({ name: z.string() }))
    .parse(local.query(`PRAGMA table_info("${table}")`).all()).map(column => `${table}.${column.name}`)).sort();
  const pgColumns = z.array(z.string()).parse(JSON.parse(await psql(
    "SELECT json_agg(table_name||'.'||column_name ORDER BY table_name,column_name) FROM information_schema.columns WHERE table_schema='public'")));
  assert.deepEqual(pgColumns, nativeColumns);

  const nativeForeignKeys = nativeNames.flatMap(table => z.array(z.object({
    table: z.string(), from: z.string(), to: z.string(), on_delete: z.string(),
  })).parse(local.query(`PRAGMA foreign_key_list("${table}")`).all())
    .map(key => `${table}.${key.from}>${key.table}.${key.to}:${key.on_delete}`)).sort();
  const pgForeignKeys = z.array(z.string()).parse(JSON.parse(await psql(`
    SELECT json_agg(edge ORDER BY edge) FROM (
      SELECT source.relname||'.'||source_column.attname||'>'||
        target.relname||'.'||target_column.attname||':'||
        CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
          WHEN 'r' THEN 'RESTRICT' WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION' END AS edge
      FROM pg_constraint c JOIN pg_class source ON source.oid=c.conrelid
      JOIN pg_class target ON target.oid=c.confrelid
      JOIN pg_namespace namespace ON namespace.oid=source.relnamespace
      CROSS JOIN LATERAL unnest(c.conkey,c.confkey) AS columns(source_number,target_number)
      JOIN pg_attribute source_column ON source_column.attrelid=source.oid AND source_column.attnum=columns.source_number
      JOIN pg_attribute target_column ON target_column.attrelid=target.oid AND target_column.attnum=columns.target_number
      WHERE c.contype='f' AND namespace.nspname='public'
    ) keys`)));
  assert.deepEqual(pgForeignKeys, nativeForeignKeys);

  await psql(`
    INSERT INTO users(id,name,primary_email,created_at,updated_at)
      VALUES('owner','Owner','Owner@Example.test','2026-10-27T00:00:00Z','2026-10-27T00:00:00Z');
    DO $$ BEGIN
      BEGIN
        INSERT INTO users(id,name,primary_email,created_at,updated_at)
          VALUES('duplicate','Duplicate','OWNER@example.test','now','now');
        RAISE EXCEPTION 'case-insensitive uniqueness was not enforced';
      EXCEPTION WHEN unique_violation THEN NULL; END;
      BEGIN
        INSERT INTO invitations(id,project_id,email,role,token_hash,expires_at,created_at)
          VALUES('invalid','missing-project','invite@example.test','editor','hash','later','now');
        RAISE EXCEPTION 'forward project foreign key was not enforced';
      EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    END $$;
    INSERT INTO provider_grants(id,provider,owner_id,label,encrypted_secret,state,scopes_json,created_at)
      VALUES('grant','fixture','owner','Bytes',decode('00ff80','hex'),'ready','[]','now');
    INSERT INTO blobs(digest,bytes,created_at) VALUES(repeat('a',64),4294967296,'now');
    INSERT INTO operations(id,kind,status,progress,created_at,updated_at)
      VALUES('operation','fixture','queued',0.123456789012345,'now','now');
    INSERT INTO audit_entries(id,at,event,target_id,details_json) VALUES('audit','now','fixture','owner','{}');
  `);
  assert.equal(await psql("SELECT id FROM users WHERE primary_email='OWNER@example.test'"), "owner");
  assert.equal(await psql("SELECT encode(encrypted_secret,'hex') FROM provider_grants WHERE id='grant'"), "00ff80");
  assert.equal(await psql("SELECT bytes FROM blobs"), "4294967296");
  assert.equal(await psql("SELECT progress FROM operations"), "0.123456789012345");
  assert.equal(await psql("SELECT seq FROM audit_entries"), "1");
  console.info("PG_FOUNDATION_VERIFIED", {
    tables: pgNames.length, columns: pgColumns.length, foreignKeyEdges: pgForeignKeys.length,
    version: await psql("SHOW server_version"),
  });
} finally {
  local.close();
  await psql(`DROP DATABASE ${database}`, "postgres");
  console.info("PG_FOUNDATION_DATABASE_CLEANED", database);
}
