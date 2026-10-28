import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Scope, ResponseOf, endpoints } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { CompilerStore } from "./store";

export async function branchPreview(context: ModuleContext, request: Request, scope: Scope):
    Promise<ResponseOf<typeof endpoints.compilePreview>> {
  await context.services.get("projects").authorizeRequest(request, scope, "read");
  return context.uow.run(async tx => {
    await tx.lock("quire:compiler");
    const store = new CompilerStore(context, tx);
    const latest = z.object({ id: IdSchema }).nullable().parse(await tx.get(`
      SELECT j.id FROM compile_jobs j JOIN snapshots s ON s.id=j.snapshot_id
      JOIN compiler_requests r ON r.job_id=j.id
      WHERE s.project_id=? AND s.branch=? AND r.preview=1
      ORDER BY j.queue_order DESC LIMIT 1`, [scope.projectId, scope.branch]));
    const job = latest ? await store.get(latest.id) : null;
    const published = z.object({ artifact_id: IdSchema }).nullable().parse(await tx.get(
      "SELECT artifact_id FROM compiler_previews WHERE project_id=? AND branch=?", [scope.projectId, scope.branch]));
    if (!published) return { job, preview: null };
    const artifact = await store.artifactById(published.artifact_id);
    const successful = await store.get(artifact.jobId);
    const current = z.object({ revision: z.number() }).parse(await tx.get(
      "SELECT revision FROM branch_workspaces WHERE project_id=? AND branch=?", [scope.projectId, scope.branch]));
    return { job, preview: { artifact, snapshot: successful.snapshot,
      stale: job?.status !== "succeeded" || job.id !== artifact.jobId || current.revision > successful.snapshot.revision,
    } };
  });
}
