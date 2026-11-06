import { z } from "zod";
import { PolicySchema, IdSchema } from "@quire/contracts";
import type { Policy } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, PolicyPort } from "@quire/runtime";
import { benefitsOf, ownerBenefits, restrictBenefits } from "./project-benefits";

export const defaultPolicy: Policy = PolicySchema.parse({
  compileSeconds: 180, writableMembers: null, historyDays: null, trackChanges: true,
  chat: true, ai: "off", aiDailyUses: 50, sharing: "named", anonymousRead: false, anonymousEdit: false,
});
const aiRank = { off: 0, ask: 1, agent: 2 } as const;
const sharingRank = { named: 0, organization: 1, anyone: 2 } as const;
const minimum = (left: number | null, right: number | null) =>
  left === null ? right : right === null ? left : Math.min(left, right);
export function intersectPolicy(left: Policy, right: Policy): Policy {
  return {
    compileSeconds: Math.min(left.compileSeconds, right.compileSeconds),
    writableMembers: minimum(left.writableMembers, right.writableMembers),
    historyDays: minimum(left.historyDays, right.historyDays),
    trackChanges: left.trackChanges && right.trackChanges, chat: left.chat && right.chat,
    ai: aiRank[left.ai] <= aiRank[right.ai] ? left.ai : right.ai,
    aiDailyUses: minimum(left.aiDailyUses, right.aiDailyUses),
    sharing: sharingRank[left.sharing] <= sharingRank[right.sharing] ? left.sharing : right.sharing,
    anonymousRead: left.anonymousRead && right.anonymousRead,
    anonymousEdit: left.anonymousEdit && right.anonymousEdit,
  };
}
export function policy(context: ModuleContext): PolicyPort {
  return {
    async forProject(actorId, projectId) {
      const { db } = context;
      const actor = (await db.get("SELECT id FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL", [actorId]));
      if (!actor) throw new ServiceError("UNAUTHENTICATED", 401, "Authentication required");
      const value = (await db.get(`SELECT p.owner_id,p.workspace_id,s.sharing FROM projects p
        JOIN account_project_sharing s ON s.project_id=p.id WHERE p.id=? AND p.deleted_at IS NULL`, [projectId]));
      if (!value) throw new ServiceError("NOT_FOUND", 404, "Project not found");
      const project = z.object({ owner_id: IdSchema, workspace_id: IdSchema.nullable(),
        sharing: z.enum(["named", "organization", "anyone"]).nullable() }).parse(value);
      const rows = z.array(z.object({ policy_json: z.string() })).parse((await db.all("SELECT policy_json FROM policy_sets WHERE (scope_kind='project' AND scope_id=?) OR (scope_kind IN ('user','federation-user') AND scope_id=?) OR scope_kind='global' OR (scope_kind='organization' AND scope_id IN (SELECT organization_id FROM members WHERE user_id=?))", [projectId, actorId, actorId])));
      const organizationRows = z.array(z.object({ policy_json: z.string() })).parse((await db.all("SELECT policy_json FROM organizations WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)", [actorId])));
      const workspaceRows = z.array(z.object({ policy_json: z.string() })).parse(await db.all(
        `SELECT policy_json FROM organizations WHERE id=?
         UNION ALL SELECT policy_json FROM policy_sets WHERE scope_kind='organization' AND scope_id=?`,
        [project.workspace_id, project.workspace_id]));
      // Only the workspace contribution is prospective. Actor memberships and every other field stay live.
      const workspacePolicies = workspaceRows.map(row => ({
        ...PolicySchema.parse(JSON.parse(row.policy_json)), sharing: project.sharing ?? "anyone" as const,
      }));
      const [first, ...rest] = [...workspacePolicies, ...[...organizationRows, ...rows].map(
        (row) => PolicySchema.parse(JSON.parse(row.policy_json)))];
      let result = first ? rest.reduce(intersectPolicy, first) : defaultPolicy;
      const grant = await ownerBenefits(context, project.owner_id);
      result = { ...result, ...(first ? restrictBenefits(grant, benefitsOf(result)) : grant) };
      const consent = (await db.get("SELECT user_id FROM identity_ai_consent WHERE user_id=? AND accepted=1", [actorId]));
      if (!consent) result = { ...result, ai: "off" };
      return result;
    },
  };
}
