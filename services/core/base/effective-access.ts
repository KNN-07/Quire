import { z } from "zod";
import type { endpoints } from "@quire/contracts";
import type { Scope, Role, ResponseOf } from "@quire/contracts";
import { editorState } from "../../accounts/governance/editor-state";
import type { CoreProjects } from "./projects";
import { fail } from "./store";
import { benefitsOf, writableAdmission } from "../../accounts/identity/project-benefits";

/** A read-only snapshot of current authority; mutation handlers still recheck it. */
export async function effectiveAccess(service: CoreProjects, request: Request, scope: Scope):
Promise<ResponseOf<typeof endpoints.projectAccess>> {
  const actorId = await service.authorizeRequest(request, scope, "read");
  const project = await service.getProject(scope.projectId);
  const policy = await service.policy(actorId ?? project.ownerId, project.id);
  const member = actorId ? await service.context.db.get<{ role: string }>(
    "SELECT role FROM project_members WHERE project_id=? AND user_id=?", [project.id, actorId]) : null;
  const linkMember = actorId ? await service.context.db.get<{ revoked_at: string | null }>(
    `SELECT s.revoked_at FROM base_link_members l JOIN project_members m ON m.id=l.member_id
     JOIN share_tokens s ON s.id=l.share_id WHERE m.project_id=? AND m.user_id=?`, [project.id, actorId]) : null;
  if (linkMember && (linkMember.revoked_at !== null || policy.sharing !== "anyone")) {
    fail("FORBIDDEN", 403, "Link access is no longer permitted");
  }
  let role: Role;
  let source: "owner" | "member" | "link";
  if (actorId === project.ownerId) { role = "owner"; source = "owner"; }
  else if (member) {
    role = z.enum(["editor", "reviewer", "viewer"]).parse(member.role);
    source = linkMember ? "link" : "member";
  } else {
    const token = request.headers.get("x-project-token") ?? new URL(request.url).searchParams.get("share");
    if (!token) fail("NOT_FOUND", 404, "Project not found");
    const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    const link = z.object({ role: z.enum(["viewer", "editor"]) }).parse(
      await service.context.db.get("SELECT role FROM share_tokens WHERE project_id=? AND token_hash=? AND revoked_at IS NULL",
        [project.id, hash]));
    role = link.role;
    source = "link";
  }
  const admitted = actorId !== null && (role === "owner" || member !== null);
  const effectiveRole = admitted && actorId ? await service.effectiveRole(actorId, project.id, role) : "viewer";
  const open = !(await editorState(service.context)).closed;
  const edit = admitted && open && (effectiveRole === "owner" || effectiveRole === "editor");
  const join = actorId !== null && !admitted && role === "editor" && open &&
    await writableAdmission(service.context, { projectId: project.id,
      actorCapacity: (await service.policy(project.ownerId, project.id)).writableMembers });
  return {
    actorId, role, source, effectiveRole, benefits: benefitsOf(policy),
    capacityLimited: admitted && role !== effectiveRole,
    branchRevision: (await service.getBranch(scope)).revision,
    capabilities: {
      read: true, edit, compile: edit, review: admitted && open && effectiveRole !== "viewer",
      chat: admitted && open && policy.chat, manageAccess: admitted && open && role === "owner", join,
    },
  };
}
