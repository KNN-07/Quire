import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { RequestContext } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { fail } from "./store";
import { hashToken } from "./access-records";
import { sourceZip } from "./archives";
import { operation, recordOperation, assertExportSource } from "./operations";
import type { ExportSource } from "./operations";

export async function anonymousExport(service: CoreProjects, request: RequestContext, input: {
  readonly projectId: Id; readonly snapshotId?: Id; readonly key: string;
}) {
  if (request.request.headers.get("origin") !== new URL(service.context.config.publicUrl).origin) {
    fail("ORIGIN_DENIED", 403, "Same-origin request required");
  }
  const token = request.request.headers.get("x-project-token");
  if (!token) fail("UNAUTHENTICATED", 401, "Project link required");
  const project = (await service.getProject(input.projectId));
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await service.authorizeRequest(request.request, scope, "download");
  const tokenHash = hashToken(token);
  const digest = hashToken(JSON.stringify({ projectId: project.id, snapshotId: input.snapshotId ?? null }));
  return service.serialized(scope, async () => {
    const prior = (await service.context.db.get<{ operation_id: string; request_digest: string }>("SELECT operation_id,request_digest FROM base_operation_grants WHERE project_id=? AND token_hash=? AND request_key=?", [project.id, tokenHash, input.key]));
    if (prior) {
      if (prior.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key reused for another export");
      return (await operation(service, IdSchema.parse(prior.operation_id)));
    }
    const snapshotId = input.snapshotId ?? (await service.one(`SELECT id FROM snapshots
      WHERE project_id=? AND branch=? AND revision=? ORDER BY created_at DESC,id DESC LIMIT 1`,
      [project.id, scope.branch, (await service.getBranch(scope)).revision], z.object({ id: IdSchema }))).id;
    const snapshot = (await service.getSnapshot(snapshotId));
    if (snapshot.scope.projectId !== project.id) fail("SCOPE_MISMATCH", 400, "Snapshot belongs to another project");
    const source: ExportSource = { snapshotId: snapshot.id, scope: snapshot.scope, revision: snapshot.revision,
      kind: input.snapshotId ? "history" : "current" };
    await assertExportSource(service, { actorId: null, source, request: request.request });
    const result = await recordOperation(service, {
      actorId: null, key: input.key, kind: "source-export",
      projectIds: [project.id], bytes: await sourceZip(service, snapshot),
      sourceSnapshots: [source],
      preflight: async bound => assertExportSource(bound, { actorId: null, source, request: request.request }),
      grant: { projectId: project.id, tokenHash, digest }
    });
    return result;
  });
}
