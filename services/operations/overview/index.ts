import { z } from "zod";
import { CompileSettingsSchema, endpoints, IdSchema, InstantSchema } from "@quire/contracts";
import type { Capability } from "@quire/contracts";
import { DiskBlobStore, LocalRepositoryService, ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { S3BlobStore } from "../storage/s3";
import { RemoteRepositoryService } from "../repository";

/** Adapter identity is configuration metadata, not a provider health probe. */
export function adapterTopology(context: Pick<ModuleContext, "db" | "blobs" | "repositories">):
{ role: string; backend: string; state: string }[] {
  return [
    { role: "API", backend: `Bun ${Bun.version}`, state: "ready" },
    { role: "Database", backend: context.db.dialect === "postgres" ? "PostgreSQL" : "SQLite", state: "ready" },
    { role: "Blobs", backend: context.blobs instanceof DiskBlobStore ? "Local content-addressed disk"
      : context.blobs instanceof S3BlobStore ? "S3-compatible object storage" : "Custom BlobStore", state: "configured" },
    { role: "Source repositories", backend: context.repositories instanceof LocalRepositoryService ? "Local Git object store"
      : context.repositories instanceof RemoteRepositoryService ? "Remote singleton Git repository service"
      : "Custom RepositoryService", state: "configured" },
  ];
}

export function register(context: ModuleContext): void {
  context.routes.register(endpoints.adminCompileQueue, async (input, request) => {
    const principal = await context.services.get("identity").require(request.request);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator access required");
    request.responseHeaders.set("cache-control", "private, no-store");
    const cursor = input.query.cursor ? await context.db.get<{ queued_at: string }>(
      "SELECT queued_at FROM compile_jobs WHERE id=?", [input.query.cursor]) : null;
    if (input.query.cursor && !cursor) throw new ServiceError("INVALID_CURSOR", 400, "Queue cursor no longer exists");
    const rows = z.array(z.object({
      id: IdSchema, project_id: IdSchema, project_name: z.string(), branch: z.string(), settings_json: z.string(),
      status: z.enum(["queued", "running"]), worker_id: IdSchema.nullable(),
      queued_at: InstantSchema, started_at: InstantSchema.nullable(),
    })).parse(await context.db.all(`SELECT j.id,s.project_id,p.name AS project_name,s.branch,j.settings_json,
      j.status,j.worker_id,j.queued_at,j.started_at FROM compile_jobs j
      JOIN snapshots s ON s.id=j.snapshot_id JOIN projects p ON p.id=s.project_id
      WHERE j.status IN ('queued','running')
        AND (?='' OR j.queued_at>? OR (j.queued_at=? AND j.id>?))
      ORDER BY j.queued_at,j.id LIMIT ?`,
    [input.query.cursor ?? "", cursor?.queued_at ?? "", cursor?.queued_at ?? "", input.query.cursor ?? "", input.query.limit + 1]));
    const items = rows.slice(0, input.query.limit).map(row => ({
      id: row.id, projectId: row.project_id, projectName: row.project_name, branch: row.branch,
      engine: CompileSettingsSchema.parse(JSON.parse(row.settings_json)).engine,
      status: row.status, workerId: row.worker_id, queuedAt: row.queued_at, startedAt: row.started_at,
    }));
    return { items, nextCursor: rows.length > input.query.limit ? items.at(-1)?.id ?? null : null };
  });
  context.routes.register(endpoints.adminOverview, async (_input, request) => {
    const principal = await context.services.get("identity").require(request.request);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator access required");
    const totals = z.object({
      users: z.number(), projects: z.number(), storageBytes: z.number(),
      queuedJobs: z.number(), runningJobs: z.number(), environments: z.number(),
    }).parse(await context.db.get(`SELECT
      (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS users,
      (SELECT count(*) FROM projects WHERE deleted_at IS NULL) AS projects,
      (SELECT CAST(coalesce(sum(bytes),0) AS BIGINT) FROM blobs) AS "storageBytes",
      (SELECT count(*) FROM compile_jobs WHERE status='queued') AS "queuedJobs",
      (SELECT count(*) FROM compile_jobs WHERE status='running') AS "runningJobs",
      (SELECT count(*) FROM environments WHERE available=1 AND retired_at IS NULL) AS environments`));
    const compiler = context.services.has("compiler");
    const projects = context.services.has("projects");
    const realtime = context.services.has("realtime");
    const ai = context.services.has("adapters") ? context.services.get("adapters").get("ai") : undefined;
    return {
      users: totals.users, projects: totals.projects, storageBytes: totals.storageBytes,
      queuedJobs: totals.queuedJobs, runningJobs: totals.runningJobs,
      capabilities: {
        projects: { enabled: projects, state: projects ? "ready" : "unconfigured" },
        collaboration: { enabled: realtime, state: realtime ? "ready" : "unconfigured" },
        compilation: { enabled: compiler, state: !compiler ? "unconfigured" : "degraded",
          reason: `${totals.environments} available compiler environments; worker readiness is not probed; queue state is reported separately.` },
        ai: ai ? await ai.availability()
          : { enabled: false, state: "unconfigured", reason: "No governed AI adapter registered." },
      } satisfies Readonly<Record<string, Capability>>,
      topology: adapterTopology(context),
    };
  });
}
