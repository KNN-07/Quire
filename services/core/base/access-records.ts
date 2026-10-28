import { z } from "zod";
import { InvitationSchema, AccessRequestSchema, IdSchema } from "@quire/contracts";
import type { Id, Transaction } from "@quire/contracts";
import type { CoreProjects } from "./projects";
import { newId } from "./store";
import { selectAdmittedMember } from "../../accounts/identity/project-benefits";
import { requireEditorOpen } from "../../accounts/governance";

export async function invitation(service: CoreProjects, id: Id) {
  return (await service.one(`SELECT id,project_id AS "projectId",organization_id AS "organizationId",email,role,status,
    expires_at AS "expiresAt",version FROM invitations WHERE id=? AND project_id IS NOT NULL`, [id], InvitationSchema));
}
export async function accessRequest(service: CoreProjects, id: Id) {
  return (await service.one(`SELECT id,project_id AS "projectId",user_id AS "userId",role,message,status,version
    FROM access_requests WHERE id=?`, [id], AccessRequestSchema));
}
export async function accessEvent(service: CoreProjects, projectId: Id, tx: Transaction): Promise<number> {
  const project = await service.withTransaction(tx).getProject(projectId);
  (await tx.run("UPDATE projects SET version=version+1,updated_at=? WHERE id=?", [service.context.clock.now(), projectId]));
  await service.context.events.record(tx, {
    topic: "access.changed", aggregateId: projectId,
    payload: { resourceId: projectId, version: project.version + 1 }
  });
  return project.version + 1;
}
export async function addMember(service: CoreProjects, input: { readonly projectId: Id; readonly userId: Id; readonly role: string }, tx: Transaction): Promise<void> {
  const bound = { ...service.context, db: tx };
  await requireEditorOpen(bound);
  const previous = z.object({ role: z.string() }).nullable().parse(await tx.get(
    "SELECT role FROM project_members WHERE project_id=? AND user_id=?", [input.projectId, input.userId]));
  (await tx.run(`DELETE FROM base_link_members WHERE member_id IN (
    SELECT id FROM project_members WHERE project_id=? AND user_id=?)`, [input.projectId, input.userId]));
  const member = z.object({ id: IdSchema }).parse(await tx.get(
    `INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,version=project_members.version+1 RETURNING id`,
    [newId(), input.projectId, input.userId, input.role, service.context.clock.now()]));
  if ((input.role === "editor" || input.role === "reviewer") && previous?.role !== "editor" && previous?.role !== "reviewer") {
    await selectAdmittedMember(bound, { projectId: input.projectId, memberId: member.id });
  }
}
export async function queueInvitation(service: CoreProjects, input: { readonly id: Id; readonly token: string; readonly email: string; readonly version: number }, tx: Transaction): Promise<void> {
  const url = new URL(`/invitations/${input.id}`, service.context.config.publicUrl);
  url.searchParams.set("token", input.token);
  (await tx.run(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,created_at)
    VALUES(?,?,?,?,?,?)`, [newId(), input.email, "Project invitation", url.toString(), `base-invite:${input.id}:${input.version}`, service.context.clock.now()]));
}
export const hashToken = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");
export const secretToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export async function memberRow(service: CoreProjects, projectId: Id, id: Id) {
  return (await service.one("SELECT id,user_id,version FROM project_members WHERE project_id=? AND (user_id=? OR id=?)",
    [projectId, id, id], z.object({ id: z.string(), user_id: z.string(), version: z.number() })));
}
