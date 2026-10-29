import { z } from "zod";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import type { BranchLease, Id, Project, Scope, Snapshot, Transaction } from "@quire/contracts";
import type { ModuleContext, PendingEvent } from "@quire/runtime";
import { AccessStore } from "./access";
import { applySourceRecords, validateSource } from "./source-records";
import type { SourceInput, SourceIntent } from "./source-records";
import type { HttpSourceReceipt } from "./receipts";
import type { SourceFinalization } from "./source-finalization";
import { fail } from "./store";

export type SourceCommitInput = {
  readonly actorId: Id; readonly scope: Scope; readonly lease: BranchLease; readonly expectedRevision: number;
  readonly inputs: readonly SourceInput[]; readonly reason?: Snapshot["reason"]; readonly advance?: boolean;
  readonly receipt?: SourceIntent["receipt"]; readonly http?: HttpSourceReceipt;
  readonly finalization?: SourceFinalization;
  readonly creation?: { readonly project: Project; readonly branchId: Id };
};
export type SourcePreparation = SourceCommitInput & { readonly newBranchId?: Id };
export type PreparedSources = {
  readonly publication: { readonly id: Id; readonly lease: BranchLease };
  readonly sources: readonly { readonly source: SourceIntent; readonly lease: BranchLease; readonly creation?: Project }[];
};

/** One existing publication, one caller-owned SQL transaction, deferred events. */
export async function finalizePreparedSources(context: ModuleContext, tx: Transaction,
  input: PreparedSources): Promise<readonly PendingEvent[]> {
  await tx.lock("quire:accounts");
  const transaction = { ...context, db: tx };
  const service = new AccessStore(transaction);
  const published = z.object({ project_id: IdSchema, updates_json: z.string() }).parse(
    await tx.get("SELECT project_id,updates_json FROM repository_intents WHERE id=?", [input.publication.id]));
  const updates = z.array(z.object({ ref: z.string(), next: GitOidSchema.nullable() })).parse(JSON.parse(published.updates_json));
  const scopes = new Set<string>();
  for (const { source, lease, creation } of input.sources) {
    const scope = source.snapshot.scope;
    const key = `${scope.projectId}:${scope.branch}`;
    if (scopes.has(key)) fail("DUPLICATE_SOURCE_SCOPE", 409, "Only one prepared source per branch may be finalized");
    scopes.add(key);
    if (published.project_id !== scope.projectId || !updates.some(update =>
      update.ref === `refs/quire/history/${source.snapshot.id}` && update.next === `sha1:${source.commit}`)) {
      fail("SOURCE_PUBLICATION_MISMATCH", 409, "The publication must contain every prepared source checkpoint");
    }
    await context.branches.assert(tx, lease);
    if (creation) {
      if (source.createBranch || creation.id !== scope.projectId || creation.ownerId !== source.snapshot.authorId
        || creation.defaultBranch !== scope.branch || creation.version !== 0 || source.projectVersion !== 0
        || source.previousRevision !== 0 || source.snapshot.revision !== 1
        || lease.scope.projectId !== scope.projectId || lease.scope.branch !== scope.branch
        || input.publication.lease.scope.projectId !== scope.projectId) {
        fail("SOURCE_CREATION_MISMATCH", 409, "Creation must match its source author, project, branch and publication");
      }
      await service.readUser(creation.ownerId);
      if (creation.workspaceId && !await tx.get("SELECT 1 FROM members WHERE organization_id=? AND user_id=?",
        [creation.workspaceId, creation.ownerId])) fail("FORBIDDEN", 403, "Workspace membership required");
      if (await tx.get("SELECT 1 FROM projects WHERE id=?", [creation.id])
        || await tx.get("SELECT 1 FROM branch_workspaces WHERE id=?", [source.branchId])
        || await tx.get("SELECT 1 FROM repositories WHERE project_id=?", [creation.id])) {
        fail("SOURCE_CREATION_EXISTS", 409, "Prepared creation identity already exists");
      }
      const main = source.files.find(file => file.id === creation.settings.mainFileId);
      if (!main?.editable || main.link || (creation.settings.engine !== "plain"
        && !source.documents.find(document => document.fileId === main.id)?.text.includes("\\documentclass"))) {
        fail("INVALID_MAIN", 422, "Prepared creation requires its validated editable main");
      }
      await tx.run(`INSERT INTO projects(id,name,owner_id,workspace_id,default_branch,settings_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`, [creation.id, creation.name, creation.ownerId, creation.workspaceId,
        creation.defaultBranch, JSON.stringify(creation.settings), creation.createdAt, creation.updatedAt]);
      await tx.run("INSERT INTO branch_workspaces(id,project_id,branch,created_at,updated_at) VALUES(?,?,?,?,?)",
        [source.branchId, creation.id, scope.branch, creation.createdAt, creation.updatedAt]);
      await tx.run("INSERT INTO repositories(project_id,relative_path,created_at) VALUES(?,?,?)",
        [creation.id, `git/${creation.id}.git`, creation.createdAt]);
    }
    if (source.createBranch) {
      const project = await service.getProject(scope.projectId);
      await service.authorize(source.snapshot.authorId, { ...scope, branch: project.defaultBranch }, "write");
      if (await tx.get("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?", [scope.projectId, scope.branch])) {
        fail("BRANCH_EXISTS", 409, "The prepared new branch already exists");
      }
      await tx.run("INSERT INTO branch_workspaces(id,project_id,branch,created_at,updated_at) VALUES(?,?,?,?,?)",
        [source.branchId, scope.projectId, scope.branch, source.snapshot.createdAt, source.snapshot.createdAt]);
    }
  }
  // Validate the whole batch before any project version is advanced by its own source writes.
  for (const { source, lease } of input.sources) await validateSource(transaction, source, lease);
  await context.repositories.finalize(tx, input.publication.id, input.publication.lease);
  const events: PendingEvent[] = [];
  for (const { source } of input.sources) events.push(...await applySourceRecords(transaction, source));
  return events;
}
