import { z } from "zod";
import { IdSchema, PolicySchema, ProjectBenefitsSchema, assertNever } from "@quire/contracts";
import type { Id, ProjectBenefits, Role } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

const minimum = (left: number | null, right: number | null) =>
  left === null ? right : right === null ? left : Math.min(left, right);
const maximum = (left: number | null, right: number | null) =>
  left === null || right === null ? null : Math.max(left, right);
type WritableMember = { readonly id: Id; readonly user_id: Id; readonly role: "editor" | "reviewer" };
export type WritableSelection = {
  readonly memberIds: readonly Id[] | null; readonly capacity: number | null;
  readonly effectiveCount: number; readonly selectionRequired: boolean;
  readonly candidates: readonly WritableMember[]; readonly members: readonly WritableMember[];
};
export function restrictBenefits(grant: ProjectBenefits, ceiling: ProjectBenefits): ProjectBenefits {
  return {
    compileSeconds: Math.min(grant.compileSeconds, ceiling.compileSeconds),
    writableMembers: minimum(grant.writableMembers, ceiling.writableMembers),
    historyDays: minimum(grant.historyDays, ceiling.historyDays),
    trackChanges: grant.trackChanges && ceiling.trackChanges,
  };
}
export function benefitsOf(policy: ProjectBenefits): ProjectBenefits {
  return ProjectBenefitsSchema.parse({
    compileSeconds: policy.compileSeconds, writableMembers: policy.writableMembers,
    historyDays: policy.historyDays, trackChanges: policy.trackChanges,
  });
}
export async function ownerBenefits(context: ModuleContext, ownerId: Id): Promise<ProjectBenefits> {
  const baseline = z.object({ benefits_json: z.string() }).parse(await context.db.get(
    "SELECT benefits_json FROM account_project_benefits WHERE scope_kind='deployment' AND scope_id='local'"));
  const rows = z.array(z.object({ benefits_json: z.string() })).parse(await context.db.all(`
SELECT g.benefits_json FROM account_project_benefits g WHERE g.benefits_json IS NOT NULL AND (
  (g.scope_kind='user' AND g.scope_id=?) OR
  (g.scope_kind='plan' AND EXISTS (
    SELECT 1 FROM billing_accounts b JOIN members m ON m.organization_id=b.organization_id
    WHERE m.user_id=? AND m.licensed=1 AND b.status='active'
      AND g.scope_id=b.provider || ':' || b.plan_id)))`, [ownerId, ownerId]));
  return rows.reduce((grant, row) => {
    const next = ProjectBenefitsSchema.parse(JSON.parse(row.benefits_json));
    return {
      compileSeconds: Math.max(grant.compileSeconds, next.compileSeconds),
      writableMembers: maximum(grant.writableMembers, next.writableMembers),
      historyDays: maximum(grant.historyDays, next.historyDays),
      trackChanges: grant.trackChanges || next.trackChanges,
    };
  }, ProjectBenefitsSchema.parse(JSON.parse(baseline.benefits_json)));
}
export async function projectBenefitCeiling(context: ModuleContext, projectId: Id): Promise<ProjectBenefits> {
  const project = z.object({ owner_id: IdSchema, workspace_id: IdSchema.nullable() }).nullable().parse(
    await context.db.get("SELECT owner_id,workspace_id FROM projects WHERE id=?", [projectId]));
  if (!project) throw new ServiceError("NOT_FOUND", 404, "Project not found");
  const rows = z.array(z.object({ policy_json: z.string() })).parse(await context.db.all(`
SELECT policy_json FROM policy_sets WHERE scope_kind='global'
  OR (scope_kind='project' AND scope_id=?)
  OR (scope_kind='organization' AND scope_id=?)
UNION ALL SELECT policy_json FROM organizations WHERE id=?`,
  [projectId, project.workspace_id, project.workspace_id]));
  return rows.reduce((grant, row) => restrictBenefits(grant, benefitsOf(PolicySchema.parse(JSON.parse(row.policy_json)))),
    await ownerBenefits(context, project.owner_id));
}
export async function writableSelection(context: ModuleContext, projectId: Id): Promise<WritableSelection> {
  const project = z.object({ owner_id: IdSchema, writable_member_ids_json: z.string().nullable() }).nullable().parse(
    await context.db.get("SELECT owner_id,writable_member_ids_json FROM projects WHERE id=? AND deleted_at IS NULL", [projectId]));
  if (!project) throw new ServiceError("NOT_FOUND", 404, "Project not found");
  const memberIds = project.writable_member_ids_json === null ? null :
    z.array(IdSchema).parse(JSON.parse(project.writable_member_ids_json));
  const members = z.array(z.object({
    id: IdSchema, user_id: IdSchema, role: z.enum(["editor", "reviewer"]),
  })).parse(await context.db.all(`SELECT id,user_id,role FROM project_members
    WHERE project_id=? AND user_id<>? AND role IN ('editor','reviewer')`, [projectId, project.owner_id]));
  const candidates = members.filter(member => memberIds === null || memberIds.includes(member.id));
  const capacity = (await projectBenefitCeiling(context, projectId)).writableMembers;
  const selectionRequired = capacity !== null && candidates.length > capacity;
  return { memberIds, capacity, effectiveCount: selectionRequired ? 0 : candidates.length,
    selectionRequired, candidates, members };
}
export async function effectiveProjectRole(context: ModuleContext, input: {
  readonly projectId: Id; readonly actorId: Id; readonly role: Role; readonly actorCapacity: number | null;
}): Promise<Role> {
  switch (input.role) {
    case "owner": case "viewer": return input.role;
    case "editor": case "reviewer": {
      const selection = await writableSelection(context, input.projectId);
      if (selection.selectionRequired || !selection.candidates.some(member => member.user_id === input.actorId)
        || (input.actorCapacity !== null && selection.candidates.length > input.actorCapacity)) return "viewer";
      return input.role;
    }
    default: return assertNever(input.role);
  }
}
export async function writableAdmission(context: ModuleContext, input: {
  readonly projectId: Id; readonly actorCapacity: number | null; readonly userId?: Id;
}): Promise<boolean> {
  const selection = await writableSelection(context, input.projectId);
  // Converting an existing writable assignment never promotes a dormant seat.
  if (selection.members.some(member => member.user_id === input.userId)) return true;
  if (selection.selectionRequired) return false;
  const capacity = minimum(selection.capacity, input.actorCapacity);
  return capacity === null || selection.candidates.length < capacity;
}
/** Caller holds quire:accounts and has already admitted this newly writable assignment. */
export async function selectAdmittedMember(context: ModuleContext, input: {
  readonly projectId: Id; readonly memberId: Id;
}): Promise<void> {
  const row = z.object({ writable_member_ids_json: z.string().nullable() }).parse(
    await context.db.get("SELECT writable_member_ids_json FROM projects WHERE id=?", [input.projectId]));
  if (row.writable_member_ids_json === null) return;
  const ids = z.array(IdSchema).parse(JSON.parse(row.writable_member_ids_json));
  if (!ids.includes(input.memberId)) await context.db.run(
    "UPDATE projects SET writable_member_ids_json=? WHERE id=?", [JSON.stringify([...ids, input.memberId]), input.projectId]);
}
/** Read the new owner's benefits only after owner_id has changed, under quire:accounts. */
export async function resetWritableSelection(context: ModuleContext, projectId: Id): Promise<void> {
  const capacity = (await projectBenefitCeiling(context, projectId)).writableMembers;
  await context.db.run("UPDATE projects SET writable_member_ids_json=? WHERE id=?",
    [capacity === null ? null : "[]", projectId]);
}
