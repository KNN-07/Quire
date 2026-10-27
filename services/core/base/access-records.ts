import { z } from "zod";
import { InvitationSchema, AccessRequestSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { CoreProjects } from "./projects";
import { newId } from "./store";

export function invitation(service: CoreProjects, id: Id) {
  return service.one(`SELECT id,project_id AS projectId,organization_id AS organizationId,email,role,status,
    expires_at AS expiresAt,version FROM invitations WHERE id=? AND project_id IS NOT NULL`, [id], InvitationSchema);
}
export function accessRequest(service: CoreProjects, id: Id) {
  return service.one(`SELECT id,project_id AS projectId,user_id AS userId,role,message,status,version
    FROM access_requests WHERE id=?`, [id], AccessRequestSchema);
}
export function accessEvent(service: CoreProjects, projectId: Id): number {
  const project = service.getProject(projectId);
  service.context.db.query("UPDATE projects SET version=version+1,updated_at=? WHERE id=?")
    .run(service.context.clock.now(), projectId);
  service.context.events.append(service.context.db, { topic: "access.changed", aggregateId: projectId,
    payload: { resourceId: projectId, version: project.version + 1 } });
  return project.version + 1;
}
export function addMember(service: CoreProjects, input: { readonly projectId: Id; readonly userId: Id; readonly role: string }): void {
  service.context.db.query(`DELETE FROM base_link_members WHERE member_id IN (
    SELECT id FROM project_members WHERE project_id=? AND user_id=?)`).run(input.projectId, input.userId);
  service.context.db.query(`INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,version=project_members.version+1`)
    .run(newId(), input.projectId, input.userId, input.role, service.context.clock.now());
}
export function queueInvitation(service: CoreProjects, input: { readonly id: Id; readonly token: string; readonly email: string; readonly version: number }): void {
  const url = new URL(`/invitations/${input.id}`, service.context.config.publicUrl);
  url.searchParams.set("token", input.token);
  service.context.db.query(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,created_at)
    VALUES(?,?,?,?,?,?)`).run(newId(), input.email, "Project invitation", url.toString(),
    `base-invite:${input.id}:${input.version}`, service.context.clock.now());
}
export const hashToken = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");
export const secretToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export function memberRow(service: CoreProjects, projectId: Id, id: Id) {
  return service.one("SELECT id,user_id,version FROM project_members WHERE project_id=? AND (user_id=? OR id=?)",
    [projectId, id, id], z.object({ id: z.string(), user_id: z.string(), version: z.number() }));
}
