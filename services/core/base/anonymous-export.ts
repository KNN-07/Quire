import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { RequestContext } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { fail } from "./store";
import { hashToken } from "./access-records";
import { sourceZip } from "./archives";
import { operation, recordOperation } from "./operations";

export async function anonymousExport(service: CoreProjects, request: RequestContext, input: {
  readonly projectId: Id; readonly snapshotId?: Id; readonly key: string;
}) {
  if (request.request.headers.get("origin") !== new URL(service.context.config.publicUrl).origin) {
    fail("ORIGIN_DENIED", 403, "Same-origin request required");
  }
  const token = request.request.headers.get("x-project-token");
  if (!token) fail("UNAUTHENTICATED", 401, "Project link required");
  const project = service.getProject(input.projectId);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await service.authorizeRequest(request.request, scope, "download");
  const tokenHash = hashToken(token);
  const digest = hashToken(JSON.stringify({ projectId: project.id, snapshotId: input.snapshotId ?? null }));
  return service.serialized(scope, async () => {
    const prior = service.context.db.query<{ operation_id: string; request_digest: string }, [string, string, string]>(
      "SELECT operation_id,request_digest FROM base_operation_grants WHERE project_id=? AND token_hash=? AND request_key=?")
      .get(project.id, tokenHash, input.key);
    if (prior) {
      if (prior.request_digest !== digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key reused for another export");
      return operation(service, IdSchema.parse(prior.operation_id));
    }
    const snapshotId = input.snapshotId ?? service.one(`SELECT id FROM snapshots
      WHERE project_id=? AND branch=? AND revision=? ORDER BY created_at DESC,id DESC LIMIT 1`,
    [project.id, scope.branch, service.getBranch(scope).revision], z.object({ id: IdSchema })).id;
    const snapshot = service.getSnapshot(snapshotId);
    if (snapshot.scope.projectId !== project.id) fail("SCOPE_MISMATCH", 400, "Snapshot belongs to another project");
    const result = await recordOperation(service, { actorId: null, key: input.key, kind: "source-export",
      projectIds: [project.id], bytes: await sourceZip(service, snapshot) });
    service.context.uow.local((tx) => tx.query(`INSERT INTO base_operation_grants
      (operation_id,project_id,token_hash,request_key,request_digest) VALUES(?,?,?,?,?)`).run(result.id, project.id, tokenHash, input.key, digest));
    return result;
  });
}
