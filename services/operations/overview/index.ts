import { z } from "zod";
import { endpoints } from "@quire/contracts";
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
