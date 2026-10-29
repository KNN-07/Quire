import { endpoints, IdSchema, MemberRoleSchema, PolicySchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { z } from "zod";
import { authorize, audit, conflict, initialPolicy, missing, newId, organization, page, publishPolicyChange, route } from "./shared";
import { enqueueNotification } from "./notifications";

function domains(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => {
    const normalized = value.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized))
      throw new ServiceError("INVALID_DOMAIN", 400, "A domain must be a DNS hostname");
    return normalized;
  }))];
}
export function registerOrganizations(context: ModuleContext): void {
  const { clock } = context;
  route(context, endpoints.organizationsList, async ({ query }, principal, _request, bound) => {
    const rows = z.array(z.object({ id: IdSchema })).parse((await bound.db.all("SELECT o.id FROM organizations o WHERE o.id>? AND (?=1 OR EXISTS(SELECT 1 FROM members m WHERE m.organization_id=o.id AND m.user_id=?)) ORDER BY o.id LIMIT ?", [query.cursor ?? "", Number(principal.operator), principal.user.id, query.limit + 1])));
    return page((await Promise.all(rows.map(async (row) => (await organization(bound, row.id))))), query.limit);
  });
  route(context, endpoints.organizationCreate, async ({ body }, principal, request, bound) => {
    const id = newId();
    const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "organization"}-${id.slice(0, 8)}`;
    if (!body.name.trim()) throw new ServiceError("INVALID_NAME", 400, "Name is required");
    await bound.db.run("INSERT INTO organizations(id,slug,name,kind,domains_json,policy_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", [id, slug, body.name.trim(), body.kind, JSON.stringify(domains(body.domains)), JSON.stringify(initialPolicy), clock.now(), clock.now()]);
    await bound.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'admin',0,?)", [newId(), id, principal.user.id, clock.now()]);
    await audit(bound, principal, { organizationId: id, event: "organization.created", targetId: id });
    request.responseHeaders.set("etag", '"v0"');
    return (await organization(bound, id));
  });
  route(context, endpoints.organizationGet, async ({ params }, principal, request, bound) => {
    const org = (await authorize(bound, principal, { organizationId: params.o, level: "member" }));
    request.responseHeaders.set("etag", `"v${org.version}"`);
    return org;
  });
  route(context, endpoints.organizationAccess, async ({ params }, principal, request, bound) => {
    const org = await authorize(bound, principal, { organizationId: params.o, level: "member" });
    const member = z.object({ role: MemberRoleSchema }).nullable().parse(
      await bound.db.get("SELECT role FROM members WHERE organization_id=? AND user_id=?", [org.id, principal.user.id]));
    request.responseHeaders.set("cache-control", "private, no-store");
    request.responseHeaders.set("etag", `"v${org.version}"`);
    return { role: member?.role ?? null, operator: principal.operator };
  });
  route(context, endpoints.organizationPatch, async ({ params, body }, principal, request, bound) => {
    const org = (await authorize(bound, principal, { organizationId: params.o, level: "admin" }));
    conflict(org.version, body.expectedVersion);
    if (body.kind !== undefined && body.kind !== org.kind)
      throw new ServiceError("ORGANIZATION_KIND_FIXED", 409, "Organization kind is fixed at creation");
    if (body.name !== undefined && !body.name.trim()) throw new ServiceError("INVALID_NAME", 400, "Name is required");
    await bound.db.run("UPDATE organizations SET name=?,kind=?,domains_json=?,version=version+1,updated_at=? WHERE id=?", [body.name?.trim() ?? org.name, body.kind ?? org.kind, JSON.stringify(domains(body.domains ?? org.domains)), clock.now(), org.id]);
    await audit(bound, principal, { organizationId: org.id, event: "organization.updated", targetId: org.id });
    request.responseHeaders.set("etag", `"v${org.version + 1}"`);
    return (await organization(bound, org.id));
  });
  route(context, endpoints.organizationDelete, async ({ params, body }, principal, _request, bound) => {
    const org = (await authorize(bound, principal, { organizationId: params.o, level: "admin" }));
    conflict(org.version, body.expectedVersion);
    if ((await bound.db.get("SELECT id FROM projects WHERE workspace_id=? UNION SELECT id FROM users WHERE managed_by=? UNION SELECT id FROM templates WHERE organization_id=? UNION SELECT id FROM template_versions WHERE organization_id=?", [org.id, org.id, org.id, org.id]))) throw new ServiceError("ORGANIZATION_IN_USE", 409, "Release managed accounts and move organization content first");
    if ((await bound.db.get("SELECT id FROM billing_accounts WHERE organization_id=?", [org.id])))
      throw new ServiceError("ORGANIZATION_IN_USE", 409, "Billing records must be retained");
    await audit(bound, principal, { organizationId: null, event: "organization.deleted", targetId: org.id });
    await bound.db.run("UPDATE audit_entries SET organization_id=NULL WHERE organization_id=?", [org.id]);
    await bound.db.run("DELETE FROM managed_acceptances WHERE organization_id=?", [org.id]);
    await bound.db.run("DELETE FROM institutional_eligibility WHERE organization_id=?", [org.id]);
    await bound.db.run("DELETE FROM policy_sets WHERE scope_kind='organization' AND scope_id=?", [org.id]);
    await bound.db.run("DELETE FROM organizations WHERE id=?", [org.id]);
    return { ok: true as const, version: org.version + 1 };
  });
  route(context, endpoints.organizationPolicy, async ({ params }, principal, request, bound) => {
    const org = (await authorize(bound, principal, { organizationId: params.o, level: "member" }));
    request.responseHeaders.set("etag", `"v${org.version}"`);
    return org.policy;
  });
  route(context, endpoints.organizationPolicyPatch, async ({ params, body }, principal, request, bound) => {
    const org = (await authorize(bound, principal, { organizationId: params.o, level: "admin" }));
    conflict(org.version, body.expectedVersion);
    const { expectedVersion: _version, ...patch } = body;
    const policy = PolicySchema.parse({ ...org.policy, ...patch });
    await bound.db.run("UPDATE organizations SET policy_json=?,version=version+1,updated_at=? WHERE id=?", [JSON.stringify(policy), clock.now(), org.id]);
    await bound.events.record(bound.db, { topic: "policy.changed", aggregateId: org.id,
      payload: { resourceId: org.id, version: org.version + 1 } });
    await publishPolicyChange(bound, { organizationId: org.id, version: org.version + 1 });
    await audit(bound, principal, { organizationId: org.id, event: "policy.updated", targetId: org.id });
    if (policy.ai !== org.policy.ai) {
      const members = z.array(z.object({ user_id: IdSchema })).parse(await bound.db.all(
        `SELECT m.user_id FROM members m JOIN users u ON u.id=m.user_id
         WHERE m.organization_id=? AND u.suspended=0 AND u.deleted_at IS NULL ORDER BY m.user_id`, [org.id]));
      for (const member of members) {
        await enqueueNotification(bound, {
          userId: member.user_id, kind: "organization.ai.changed", resourceId: org.id,
          dedupeKey: `organization-ai:${org.id}:${org.version + 1}`,
          mail: { subject: "Organization AI policy changed",
            body: `AI policy for ${org.name} changed from ${org.policy.ai} to ${policy.ai}.` },
        });
      }
    }
    request.responseHeaders.set("etag", `"v${org.version + 1}"`);
    return policy;
  });
  context.routes.register(endpoints.institutionGet, async ({ params }) => {
    const value = (await context.db.get("SELECT id FROM organizations WHERE slug=? AND kind='institution'", [params.slug]));
    if (!value) throw missing();
    return (await organization(context, z.object({ id: IdSchema }).parse(value).id));
  });
}
