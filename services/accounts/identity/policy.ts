import { z } from "zod";
import { PolicySchema } from "@quire/contracts";
import type { Policy } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, PolicyPort } from "@quire/runtime";

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
      const actor = db.query("SELECT id FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL").get(actorId);
      if (!actor) throw new ServiceError("UNAUTHENTICATED", 401, "Authentication required");
      const value = db.query("SELECT workspace_id FROM projects WHERE id=? AND deleted_at IS NULL").get(projectId);
      if (!value) throw new ServiceError("NOT_FOUND", 404, "Project not found");
      const project = z.object({ workspace_id: z.string().nullable() }).parse(value);
      const rows = z.array(z.object({ policy_json: z.string() })).parse(db.query(
        "SELECT policy_json FROM policy_sets WHERE (scope_kind='project' AND scope_id=?) OR (scope_kind='user' AND scope_id=?) OR scope_kind='global' OR (scope_kind='organization' AND scope_id IN (SELECT organization_id FROM members WHERE user_id=?)) OR (scope_kind='organization' AND scope_id=?)")
        .all(projectId, actorId, actorId, project.workspace_id));
      const organizationRows = z.array(z.object({ policy_json: z.string() })).parse(db.query(
        "SELECT policy_json FROM organizations WHERE id=? OR id IN (SELECT organization_id FROM members WHERE user_id=?)")
        .all(project.workspace_id, actorId));
      const [first, ...rest] = [...organizationRows, ...rows].map(
        (row) => PolicySchema.parse(JSON.parse(row.policy_json)));
      let result = first ? rest.reduce(intersectPolicy, first) : defaultPolicy;
      const consent = db.query("SELECT user_id FROM identity_ai_consent WHERE user_id=? AND accepted=1").get(actorId);
      if (!consent) result = { ...result, ai: "off" };
      return result;
    },
  };
}
