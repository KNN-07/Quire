import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DigestSchema, GitOidSchema, IdSchema } from "@quire/contracts";
import type { BranchLease, Id } from "@quire/contracts";
import type { Runtime, SqlValue } from "@quire/runtime";
import { StorageError } from "@quire/runtime";

const identifier = (value: string) => `"${z.string().regex(/^[a-z_][a-z_0-9]*$/).parse(value)}"`;

/** Offline-only: the operator must stop all writers and workers before entry. */
export async function transferQuiesced(source: Runtime, target: Runtime, quiesced: boolean) {
  if (!quiesced || source.db.dialect !== "sqlite" || target.db.dialect !== "postgres") {
    throw new StorageError("TRANSFER_QUIESCENCE_REQUIRED", "Stopped native source and PostgreSQL target required");
  }
  let sourceKey = source.secretKey;
  try { sourceKey = Buffer.from((await readFile(join(source.config.dataDir, "secret.key"), "utf8")).trim(), "hex"); }
  catch (error) {
    // Configured native keys need not also exist in a local key file.
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  if (sourceKey.length !== target.secretKey.length || !timingSafeEqual(sourceKey, target.secretKey)) {
    throw new StorageError("TRANSFER_KEY_MISMATCH", "Set QUIRE_SECRET_KEY to the original native instance key");
  }
  for (const sql of [
    "SELECT id FROM base_source_intents", "SELECT id FROM repository_intents WHERE state<>'finalized'",
    "SELECT id FROM core_git_intents", "SELECT id FROM git_intents WHERE state<>'finalized'",
    "SELECT id FROM review_decision_intents", "SELECT id FROM review_restore_intents",
    "SELECT id FROM compile_jobs WHERE status IN ('queued','running')",
  ]) {
    if (await source.db.get(sql)) throw new StorageError("TRANSFER_RECOVERY_REQUIRED", sql);
  }
  if (await target.db.get("SELECT id FROM users") || await target.db.get("SELECT id FROM projects")) {
    throw new StorageError("TRANSFER_TARGET_NOT_EMPTY", "Use a fresh migrated target");
  }
  const tables = (await source.db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name"))
    .map((row) => row.name);
  const remaining = new Set(tables);
  const ordered: string[] = [];
  while (remaining.size) {
    let progress = false;
    for (const table of remaining) {
      const foreign = await source.db.all<{ table: string }>(`PRAGMA foreign_key_list(${identifier(table)})`);
      if (foreign.some((key) => key.table !== table && remaining.has(key.table))) continue;
      ordered.push(table); remaining.delete(table); progress = true;
    }
    if (!progress) throw new StorageError("TRANSFER_FOREIGN_KEY_CYCLE", [...remaining].join(","));
  }
  let blobs = 0;
  for (const row of await source.db.all<{ digest: string }>("SELECT digest FROM blobs ORDER BY digest")) {
    const bytes = await source.blobs.get(DigestSchema.parse(row.digest));
    if (await target.blobs.put(bytes) !== row.digest) throw new StorageError("TRANSFER_BLOB_MISMATCH", row.digest);
    blobs++;
  }
  const publications: { id: Id; lease: BranchLease }[] = [];
  for (const row of await source.db.all<{ project_id: string }>("SELECT project_id FROM repositories ORDER BY project_id")) {
    const projectId = IdSchema.parse(row.project_id);
    await source.repositories.assertReadable(projectId);
    const path = join(source.config.dataDir, "git", `${projectId}.git`);
    // Include every immutable object, including staged objects not reachable from refs.
    const objects = await git(path, ["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"]);
    const pack = await git(path, ["pack-objects", "--stdout"], objects);
    await target.repositories.initialize(projectId);
    await target.repositories.importPack(projectId, pack);
    const refs = new TextDecoder().decode(await git(path, ["for-each-ref", "--format=%(refname) %(objectname)"])).trim();
    if (!refs) continue;
    const scope = { projectId, branch: "main" };
    const lease = await target.branches.acquire(scope, crypto.randomUUID(), 300000);
    if (!lease) throw new StorageError("BRANCH_BUSY", projectId);
    const id = IdSchema.parse(crypto.randomUUID());
    try {
      await target.repositories.publish({ id, lease, updates: refs.split("\n").map((line) => {
        const [ref = "", oid = ""] = line.split(" ");
        return { ref, expected: null, next: GitOidSchema.parse(`sha1:${oid}`) };
      }) });
      publications.push({ id, lease });
    } catch (error) { await target.branches.release(lease); throw error; }
  }
  const counts: Record<string, number> = {};
  try {
    await target.uow.run(async (tx) => {
      await tx.lock("quire:transfer");
      // Singleton counters have migrated defaults; all other domain tables are empty.
      await tx.run("DELETE FROM event_counter");
      await tx.run("DELETE FROM compiler_queue_counter");
      for (const table of ordered) {
        if (table === "branch_leases") continue; // Merge expired fence history after repository finalization.
        const rows = await source.db.all<Record<string, SqlValue>>(`SELECT * FROM ${identifier(table)}`);
        counts[table] = rows.length;
        for (const row of rows) {
          const columns = Object.keys(row);
          await tx.run(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            columns.map((column) => row[column] ?? null));
        }
      }
      for (const publication of publications) await target.repositories.finalize(tx, publication.id, publication.lease);
      const leases = await source.db.all<{ project_id: string; branch: string; owner: string; fence: number }>(
        "SELECT project_id,branch,owner,fence FROM branch_leases");
      counts["branch_leases"] = leases.length;
      for (const lease of leases) await tx.run(
        "INSERT INTO branch_leases(project_id,branch,owner,fence,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,branch) DO UPDATE SET fence=GREATEST(branch_leases.fence,excluded.fence),expires_at=excluded.expires_at",
        [lease.project_id, lease.branch, lease.owner, lease.fence, target.clock.now()]);
      // Explicit audit identities must not leave PostgreSQL's next generated value behind.
      await tx.exec("SELECT setval(pg_get_serial_sequence('audit_entries','seq'), GREATEST(COALESCE((SELECT MAX(seq) FROM audit_entries),0),1), EXISTS(SELECT 1 FROM audit_entries))");
    });
  } finally {
    for (const publication of publications) await target.branches.release(publication.lease);
  }
  return { tables: counts, blobs, repositories: publications.length,
    nativeMigrations: await source.db.all("SELECT * FROM schema_migrations ORDER BY id") };
}

async function git(path: string, args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
  const child = Bun.spawn(["git", "--git-dir", path, ...args], {
    stdin: input ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (input && child.stdin) { await child.stdin.write(input); await child.stdin.end(); }
  const [bytes, error, code] = await Promise.all([new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new StorageError("TRANSFER_GIT_FAILED", error);
  return new Uint8Array(bytes);
}
