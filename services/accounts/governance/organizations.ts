import { endpoints, IdSchema, PolicySchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { z } from "zod";
import { authorize, audit, conflict, initialPolicy, missing, newId, organization, page, publishPolicyChange, route } from "./shared";

function domains(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => {
    const normalized = value.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized))
      throw new ServiceError("INVALID_DOMAIN", 400, "A domain must be a DNS hostname");
    return normalized;
  }))];
}
export function registerOrganizations(context: ModuleContext): void {
  const { db, clock } = context;
  route(context, endpoints.organizationsList, ({ query }, principal) => {
    const rows = z.array(z.object({ id: IdSchema })).parse(db.query(
      "SELECT o.id FROM organizations o WHERE o.id>? AND (?=1 OR EXISTS(SELECT 1 FROM members m WHERE m.organization_id=o.id AND m.user_id=?)) ORDER BY o.id LIMIT ?")
      .all(query.cursor ?? "", Number(principal.operator), principal.user.id, query.limit + 1));
    return page(rows.map((row) => organization(context, row.id)), query.limit);
  });
  route(context, endpoints.organizationCreate, ({ body }, principal, request) => {
    const id = newId();
    const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "organization"}-${id.slice(0, 8)}`;
    if (!body.name.trim()) throw new ServiceError("INVALID_NAME", 400, "Name is required");
    db.query("INSERT INTO organizations(id,slug,name,kind,domains_json,policy_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, slug, body.name.trim(), body.kind, JSON.stringify(domains(body.domains)), JSON.stringify(initialPolicy), clock.now(), clock.now());
    db.query("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'admin',0,?)")
      .run(newId(), id, principal.user.id, clock.now());
    audit(context, principal, { organizationId: id, event: "organization.created", targetId: id });
    request.responseHeaders.set("etag", '"v0"');
    return organization(context, id);
  });
  route(context, endpoints.organizationGet, ({ params }, principal, request) => {
    const org = authorize(context, principal, { organizationId: params.o, level: "member" });
    request.responseHeaders.set("etag", `"v${org.version}"`);
    return org;
  });
  route(context, endpoints.organizationPatch, ({ params, body }, principal, request) => {
    const org = authorize(context, principal, { organizationId: params.o, level: "admin" });
    conflict(org.version, body.expectedVersion);
    if (body.name !== undefined && !body.name.trim()) throw new ServiceError("INVALID_NAME", 400, "Name is required");
    db.query("UPDATE organizations SET name=?,kind=?,domains_json=?,version=version+1,updated_at=? WHERE id=?")
      .run(body.name?.trim() ?? org.name, body.kind ?? org.kind, JSON.stringify(domains(body.domains ?? org.domains)), clock.now(), org.id);
    audit(context, principal, { organizationId: org.id, event: "organization.updated", targetId: org.id });
    request.responseHeaders.set("etag", `"v${org.version + 1}"`);
    return organization(context, org.id);
  });
  route(context, endpoints.organizationDelete, ({ params, body }, principal) => {
    const org = authorize(context, principal, { organizationId: params.o, level: "admin" });
    conflict(org.version, body.expectedVersion);
    if (db.query("SELECT id FROM projects WHERE workspace_id=? UNION SELECT id FROM users WHERE managed_by=? UNION SELECT id FROM templates WHERE organization_id=? UNION SELECT id FROM template_versions WHERE organization_id=?")
      .get(org.id, org.id, org.id, org.id)) throw new ServiceError("ORGANIZATION_IN_USE", 409, "Release managed accounts and move organization content first");
    if (db.query("SELECT id FROM billing_accounts WHERE organization_id=?").get(org.id))
      throw new ServiceError("ORGANIZATION_IN_USE", 409, "Billing records must be retained");
    audit(context, principal, { organizationId: null, event: "organization.deleted", targetId: org.id });
    db.query("UPDATE audit_entries SET organization_id=NULL WHERE organization_id=?").run(org.id);
    db.query("DELETE FROM managed_acceptances WHERE organization_id=?").run(org.id);
    db.query("DELETE FROM institutional_eligibility WHERE organization_id=?").run(org.id);
    db.query("DELETE FROM policy_sets WHERE scope_kind='organization' AND scope_id=?").run(org.id);
    db.query("DELETE FROM organizations WHERE id=?").run(org.id);
    return { ok: true as const, version: org.version + 1 };
  });
  route(context, endpoints.organizationPolicy, ({ params }, principal, request) => {
    const org = authorize(context, principal, { organizationId: params.o, level: "member" });
    request.responseHeaders.set("etag", `"v${org.version}"`);
    return org.policy;
  });
  route(context, endpoints.organizationPolicyPatch, ({ params, body }, principal, request) => {
    const org = authorize(context, principal, { organizationId: params.o, level: "admin" });
    conflict(org.version, body.expectedVersion);
    const { expectedVersion: _version, ...patch } = body;
    const policy = PolicySchema.parse({ ...org.policy, ...patch });
    db.query("UPDATE organizations SET policy_json=?,version=version+1,updated_at=? WHERE id=?")
      .run(JSON.stringify(policy), clock.now(), org.id);
    context.events.append(db, { topic: "policy.changed", aggregateId: org.id,
      payload: { resourceId: org.id, version: org.version + 1 } });
    publishPolicyChange(context, { organizationId: org.id, version: org.version + 1 });
    audit(context, principal, { organizationId: org.id, event: "policy.updated", targetId: org.id });
    request.responseHeaders.set("etag", `"v${org.version + 1}"`);
    return policy;
  });
  context.routes.register(endpoints.institutionGet, ({ params }) => {
    const value = db.query("SELECT id FROM organizations WHERE slug=? AND kind='institution'").get(params.slug);
    if (!value) throw missing();
    return organization(context, z.object({ id: IdSchema }).parse(value).id);
  });
}
