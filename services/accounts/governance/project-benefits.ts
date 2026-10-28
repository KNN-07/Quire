import { z } from "zod";
import { endpoints, IdSchema, ProjectBenefitsSchema, assertNever } from "@quire/contracts";
import type { RequestOf } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import { fresh } from "./billing";
import { operator } from "./reports";
import { audit, conflict, missing, publishPolicyChange, route } from "./shared";
import type { TransactionContext } from "./shared";

type BenefitKey = RequestOf<typeof endpoints.adminProjectBenefitsGet>["params"];
async function admit(context: TransactionContext, principal: Principal, key: BenefitKey): Promise<void> {
  operator(principal);
  if (!await context.db.get(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE u.id=? AND s.id=? AND s.expires_at>? AND u.operator=1 AND u.suspended=0 AND u.deleted_at IS NULL`,
  [principal.user.id, principal.sessionId, context.clock.now()])) {
    throw new ServiceError("FORBIDDEN", 403, "Active operator session required");
  }
  await fresh(context, principal);
  switch (key.kind) {
    case "user":
      if (!await context.db.get("SELECT id FROM users WHERE id=? AND deleted_at IS NULL", [key.key])) throw missing();
      break;
    case "deployment": case "plan": break;
    default: assertNever(key);
  }
}
async function read(context: ModuleContext, key: BenefitKey) {
  const row = z.object({ benefits_json: z.string().nullable(), version: z.number().int().nonnegative() }).nullable().parse(
    await context.db.get("SELECT benefits_json,version FROM account_project_benefits WHERE scope_kind=? AND scope_id=?", [key.kind, key.key]));
  return { benefits: row?.benefits_json ? ProjectBenefitsSchema.parse(JSON.parse(row.benefits_json)) : null,
    version: row?.version ?? 0 };
}
export function registerProjectBenefits(context: ModuleContext): void {
  route(context, endpoints.adminProjectBenefitsGet, async ({ params }, principal, request, bound) => {
    await admit(bound, principal, params);
    const current = await read(bound, params);
    request.responseHeaders.set("cache-control", "private, no-store");
    return current;
  });
  route(context, endpoints.adminProjectBenefitsPut, async ({ params, body }, principal, _request, bound) => {
    await admit(bound, principal, params);
    switch (params.kind) {
      case "deployment":
        if (body.benefits === null) throw new ServiceError("DEPLOYMENT_BENEFITS_REQUIRED", 422, "Deployment baseline cannot be withdrawn");
        break;
      case "user": case "plan": break;
      default: assertNever(params);
    }
    const current = await read(bound, params);
    conflict(current.version, body.expectedVersion);
    const version = current.version + 1;
    await bound.db.run(`INSERT INTO account_project_benefits(scope_kind,scope_id,benefits_json,version,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(scope_kind,scope_id) DO UPDATE SET benefits_json=excluded.benefits_json,
      version=excluded.version,updated_at=excluded.updated_at`,
    [params.kind, params.key, body.benefits === null ? null : JSON.stringify(body.benefits), version, bound.clock.now()]);
    await audit(bound, principal, { organizationId: null, targetId: principal.user.id, event: "project-benefits.updated",
      details: { scopeKind: params.kind, scopeKey: params.key, version, withdrawn: body.benefits === null } });
    switch (params.kind) {
      case "deployment":
        await publishPolicyChange(bound, { version });
        break;
      case "user":
        await publishPolicyChange(bound, { userId: params.key, version });
        break;
      case "plan": {
        const organizations = z.array(z.object({ organization_id: IdSchema })).parse(await bound.db.all(
          "SELECT organization_id FROM billing_accounts WHERE organization_id IS NOT NULL AND provider || ':' || plan_id=?",
          [params.key]));
        for (const organization of organizations) await publishPolicyChange(bound, { organizationId: organization.organization_id, version });
        break;
      }
      default: assertNever(params);
    }
    return { benefits: body.benefits, version };
  });
}
