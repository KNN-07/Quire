import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { RouteRegistry, ServiceRegistry, SqliteEventPort } from "@quire/runtime";
import { CompilerService } from "../../../../services/compiler/service";
import { CompilerLeases } from "../../../../services/compiler/leases";
import { openMaintenanceBinding } from "../../../../services/operations/installation/prepared-storage-host";
import { fixtureIds } from "../../../fixtures/foundation";
import { executionFixture, id, limits } from "./fixture";

test("stopped backup performs real compiler fencing and archives undispatched cancellation events", async () => {
  await using fixture = await executionFixture();
  const controller = await fixture.start();
  await controller.request("stop", { command: fixture.update, release: fixture.accepted });
  const opened = await openMaintenanceBinding(fixture.prior);
  const admission = opened.adapters.admission;
  if (!admission) throw new Error("Real admission required");
  const events = new SqliteEventPort(opened.context.db, opened.context.clock);
  const service = new CompilerService({ ...opened.context, admission, events,
    services: new ServiceRegistry(), routes: new RouteRegistry(undefined, admission).forLane("C") }, null);
  const jobs = [id(), id()];
  const priorFences = new Map<string, number>();
  try {
    await opened.context.db.run("UPDATE o_worker_policy SET maximum=2 WHERE id=1");
    for (const [order, jobId] of jobs.entries()) {
      await opened.context.db.run(`INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,
        queued_at,idempotency_key,queue_order) VALUES(?,?,?,?,?,'queued',?,?,?)`,
      [jobId, fixtureIds.kien, fixtureIds.snapshot, fixtureIds.environment,
        JSON.stringify({ engine: "pdflatex", mainFileId: fixtureIds.mainFile, environmentId: fixtureIds.environment,
          draft: false, stopOnFirstError: false }), opened.context.clock.now(), `p9-${order}`, order + 1]);
      await opened.context.db.run("INSERT INTO compiler_requests(job_id,digest,clean,limits_json,cache_key) VALUES(?,?,1,?,NULL)",
        [jobId, jobId, JSON.stringify(limits)]);
    }
    const lease = await new CompilerLeases(service).lease(fixtureIds.operator, [fixtureIds.environment]);
    expect(lease).not.toBeNull();
    for (const row of await opened.context.db.all<{ id: string; fencing_token: number }>(
      "SELECT id,fencing_token FROM compile_jobs WHERE id IN (?,?)", jobs)) priorFences.set(row.id, row.fencing_token);
    expect(priorFences.size).toBe(2);
  } finally { await service.stop(); await events.close(); await opened.close(); }
  const backup = z.object({ path: z.string() }).parse(await controller.request("backup", {}));
  const image = z.object({ tables: z.array(z.object({ name: z.string(), rows: z.array(z.record(z.string(), z.unknown())) })) })
    .parse(JSON.parse(await readFile(join(backup.path, "database.json"), "utf8")));
  const archivedJobs = image.tables.find(table => table.name === "compile_jobs")?.rows ?? [];
  expect(archivedJobs.filter(row => jobs.includes(IdSchema.parse(row["id"]))))
    .toHaveLength(2);
  expect(archivedJobs.filter(row => jobs.includes(IdSchema.parse(row["id"])))
    .every(row => row["status"] === "canceled" && row["failure_code"] === "BACKUP_QUIESCED")).toBe(true);
  const fresh = await openMaintenanceBinding(fixture.prior);
  try {
    expect(await fresh.context.db.get("SELECT job_id FROM worker_leases")).toBeNull();
    const canceled = await fresh.context.db.all<{ published_at: string | null }>(
      "SELECT o.published_at FROM outbox o JOIN events e ON e.seq=o.event_seq WHERE e.topic='job.changed' AND json_extract(e.payload_json,'$.status')='canceled'");
    expect(canceled).toHaveLength(2);
    expect(canceled.every(row => row.published_at === null)).toBe(true);
    const stored = await fresh.context.db.all<{ id: string; fencing_token: number }>("SELECT id,fencing_token FROM compile_jobs ORDER BY queue_order");
    for (const row of stored) expect(row.fencing_token).toBeGreaterThan(priorFences.get(row.id) ?? 0);
    await fresh.context.db.run(`INSERT INTO operations(id,actor_id,kind,status,progress,idempotency_key,created_at,updated_at)
      VALUES(?,?,'adapter','running',0,?,?,?)`, [id(), fixtureIds.kien, "p9-pending-adapter",
      fresh.context.clock.now(), fresh.context.clock.now()]);
  } finally { await fresh.close(); }
  expect(await controller.request("backup", {})).toMatchObject({ failure: "BACKUP_RECOVERY_REQUIRED" });
}, 180000);
