import { access, constants } from "node:fs/promises";
import { z } from "zod";
import { endpoints } from "@quire/contracts";
import type { Capability } from "@quire/contracts";
import { DiskBlobStore, ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

export function register(context: ModuleContext): void {
  context.routes.register(endpoints.adminOverview, async (_input, request) => {
    const principal = await context.services.get("identity").require(request.request);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator access required");
    const totals = z.object({
      users: z.number(), projects: z.number(), storageBytes: z.number(),
      queuedJobs: z.number(), runningJobs: z.number(), environments: z.number(),
    }).parse(context.db.query(`SELECT
      (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS users,
      (SELECT count(*) FROM projects WHERE deleted_at IS NULL) AS projects,
      (SELECT coalesce(sum(bytes),0) FROM blobs) AS storageBytes,
      (SELECT count(*) FROM compile_jobs WHERE status='queued') AS queuedJobs,
      (SELECT count(*) FROM compile_jobs WHERE status='running') AS runningJobs,
      (SELECT count(*) FROM environments WHERE available=1 AND retired_at IS NULL) AS environments`).get());
    const journal = z.object({ journal_mode: z.string() }).parse(context.db.query("PRAGMA journal_mode").get());
    if (!(context.blobs instanceof DiskBlobStore)) {
      throw new ServiceError("TOPOLOGY_UNAVAILABLE", 503, "This overview requires the native storage profile");
    }
    await access(context.blobs.root, constants.R_OK | constants.W_OK);
    const compiler = context.services.has("compiler");
    const projects = context.services.has("projects");
    const realtime = context.services.has("realtime");
    const ai = context.services.has("ai");
    return {
      users: totals.users, projects: totals.projects, storageBytes: totals.storageBytes,
      queuedJobs: totals.queuedJobs, runningJobs: totals.runningJobs,
      capabilities: {
        projects: { enabled: projects, state: projects ? "ready" : "unconfigured" },
        collaboration: { enabled: realtime, state: realtime ? "ready" : "unconfigured" },
        compilation: { enabled: compiler, state: !compiler ? "unconfigured" : totals.environments ? "ready" : "degraded",
          reason: `${totals.environments} available compiler environments; queue state is reported separately.` },
        ai: { enabled: ai, state: ai ? "ready" : "unconfigured", reason: ai ? "AI service registered." : "No AI service registered." },
      } satisfies Readonly<Record<string, Capability>>,
      topology: [
        { role: "API", backend: `Bun ${Bun.version}`, state: "ready" },
        { role: "Database", backend: `SQLite ${journal.journal_mode.toUpperCase()}`, state: "ready" },
        { role: "Blobs", backend: "Local content-addressed disk", state: "ready" },
        ...(projects ? [{ role: "Source repositories", backend: "Local Git object store", state: "ready" }] : []),
      ],
    };
  });
}
