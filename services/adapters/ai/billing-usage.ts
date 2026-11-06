import type { Id } from "@quire/contracts";
import { InstantSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { projectBenefitCeiling, writableSelection } from "../../accounts/identity/project-benefits";
import type { Actor } from "./model";
import type { AiStore } from "./store";

/** Receipt counts are actor-wide; limits are meaningful only in an authorized project. */
export async function billingUsage(store: AiStore, actor: Actor, projectId?: Id) {
  const { context } = store;
  await store.core().readUser(actor.id);
  const observedAt = context.clock.now();
  const day = observedAt.slice(0, 10);
  const resetsAt = InstantSchema.parse(new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString());
  const rows = await context.db.all<{ state: string; n: number }>(
    "SELECT state,count(*) AS n FROM ai_usage WHERE user_id=? AND day=? GROUP BY state", [actor.id, day]);
  const counts = {
    day, observedAt, resetsAt, used: rows.find(row => row.state === "dispatched")?.n ?? 0,
    reserved: rows.find(row => row.state === "reserved")?.n ?? 0,
    refunded: rows.find(row => row.state === "refunded")?.n ?? 0,
  };
  if (!projectId) return { ...counts, project: null };
  const project = await store.core().getProject(projectId);
  const scope = { projectId, branch: project.defaultBranch };
  await store.core().authorize(actor.id, scope, "read");
  const benefits = await projectBenefitCeiling(context, projectId);
  const selection = await writableSelection(context, projectId);
  const policy = await store.core().policy(actor.id, projectId);
  let aiDailyLimit: number | null = null;
  let aiUnavailable: string | null = null;
  try {
    const authority = await store.authorize(actor, { scope, mode: "ask" });
    // Admission applies the default even when the policy ceiling is null.
    aiDailyLimit = authority.policy.aiDailyUses ?? 50;
  } catch (error) {
    if (!(error instanceof ServiceError) || ![403, 503].includes(error.status)) throw error;
    aiUnavailable = error.message;
  }
  return { ...counts, project: {
    id: project.id, name: project.name, ownerId: project.ownerId, aiDailyLimit, aiUnavailable,
    writableMembers: benefits.writableMembers, assignedMembers: selection.members.length,
    effectiveMembers: selection.effectiveCount, selectionRequired: selection.selectionRequired,
    compileSeconds: policy.compileSeconds,
  } };
}
