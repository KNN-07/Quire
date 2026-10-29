import { z } from "zod";
import { endpoints, CountSchema, IdSchema, ManagedStateSchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { authorize, membership, page, requireTeamOrganization, route } from "./shared";

export function registerManagementReads(context: ModuleContext): void {
  route(context, endpoints.organizationManagementList, async ({ params, query }, principal, request, bound) => {
    const org = await authorize(bound, principal, { organizationId: params.o, level: "admin" });
    requireTeamOrganization(org);
    const values = await bound.db.all(`SELECT m.*,u.name,u.primary_email,u.version AS user_version,
      u.managed_by,u.suspended,u.deleted_at,a.id AS management_id,a.state AS management_state,a.version AS management_version,
      CASE WHEN EXISTS(SELECT 1 FROM verified_emails e WHERE e.user_id=u.id AND lower(e.email)=lower(u.primary_email)) THEN 1 ELSE 0 END AS primary_verified
      FROM members m JOIN users u ON u.id=m.user_id
      LEFT JOIN managed_acceptances a ON a.organization_id=m.organization_id AND a.user_id=m.user_id
      WHERE m.organization_id=? AND u.id>? ORDER BY u.id LIMIT ?`, [org.id, query.cursor ?? "", query.limit + 1]);
    const items = values.map(value => {
      const member = membership(value);
      const row = z.object({
        name: z.string(), primary_email: z.email(), user_version: CountSchema,
        managed_by: IdSchema.nullable(), suspended: z.number(), deleted_at: z.string().nullable(),
        management_id: IdSchema.nullable(), management_state: ManagedStateSchema.nullable(),
        management_version: CountSchema.nullable(), primary_verified: z.number(),
      }).parse(value);
      const management = row.management_id === null ? null : {
        id: row.management_id, state: ManagedStateSchema.parse(row.management_state),
        version: CountSchema.parse(row.management_version),
      };
      const active = row.suspended === 0 && row.deleted_at === null;
      const managedHere = row.managed_by === org.id && row.deleted_at === null
        && (management?.state === "accepted" || management?.state === "suspended");
      return { id: member.userId, name: row.name, email: row.primary_email, member, userVersion: row.user_version, management,
        canInvite: active && row.managed_by === null && (management === null || management.state === "released"),
        canRelease: managedHere, canDelete: managedHere,
        canReceiveProjects: active && managedHere && management?.state === "accepted" && row.primary_verified === 1,
      };
    });
    request.responseHeaders.set("cache-control", "private, no-store");
    return page(items, query.limit);
  });
  route(context, endpoints.managementList, async ({ query }, principal, request, bound) => {
    const rows = z.array(z.object({
      id: IdSchema, organization_id: IdSchema, organization_name: z.string(),
      organization_kind: z.enum(["team", "institution"]), state: ManagedStateSchema, version: CountSchema,
      account_managed_by: IdSchema.nullable(), member_exists: z.number(),
    })).parse(await bound.db.all(`SELECT a.id,a.organization_id,a.state,a.version,o.name AS organization_name,o.kind AS organization_kind,
      u.managed_by AS account_managed_by,
      CASE WHEN EXISTS(SELECT 1 FROM members m WHERE m.organization_id=a.organization_id AND m.user_id=a.user_id) THEN 1 ELSE 0 END AS member_exists
      FROM managed_acceptances a JOIN organizations o ON o.id=a.organization_id JOIN users u ON u.id=a.user_id
      WHERE a.user_id=? AND a.id>? ORDER BY a.id LIMIT ?`, [principal.user.id, query.cursor ?? "", query.limit + 1]));
    request.responseHeaders.set("cache-control", "private, no-store");
    return page(rows.map(row => ({ id: row.id, organizationId: row.organization_id, organizationName: row.organization_name,
      state: row.state, version: row.version,
      canAccept: row.organization_kind === "team" && row.state === "invited" && row.account_managed_by === null && row.member_exists === 1,
    })), query.limit);
  });
}
