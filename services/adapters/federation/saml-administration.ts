import { z } from "zod";
import { endpoints, IdSchema, resourceVersionTag } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { Id } from "@quire/contracts";
import { authentication } from "../../accounts/identity/authentication";
import { passwordAllowed } from "../../accounts/identity/reads";
import { hash, newId, store } from "../../accounts/identity/store";
import { authorize, audit } from "../../accounts/governance/shared";
import type { TransactionContext } from "../../accounts/governance/shared";
import { revokeSessions } from "../../accounts/governance/managed";
import type { FederationServices } from "./oidc";

async function status(services: FederationServices, bound: TransactionContext, organizationId: Id) {
  const settings = await services.configurations.get(bound.db);
  const configured = services.configurations.deployment.organizationId === organizationId &&
    settings.config.protocol === "saml" && settings.config.saml !== null;
  const rows = configured ? z.array(z.object({
    id: IdSchema, name: z.string(), primary_email: z.string(), password_hash: z.string().nullable(),
    managed_by: z.string().nullable(), version: z.number(), member_version: z.number(),
    suspended: z.number(), deleted_at: z.string().nullable(),
  })).parse(await bound.db.all(`SELECT u.*,m.version AS member_version FROM users u
    JOIN members m ON m.user_id=u.id WHERE m.organization_id=? ORDER BY u.id`, [organizationId])) : [];
  const items = [];
  for (const row of rows) {
    const linked = Boolean(await bound.db.get(`SELECT i.id FROM identities i JOIN federation_saml_links s ON s.identity_id=i.id
      WHERE i.user_id=? AND i.authority_kind='organization' AND i.organization_id=?`, [row.id, organizationId]));
    const unproven = Boolean(await bound.db.get(`SELECT i.id FROM identities i
      WHERE i.user_id=? AND i.issuer=? AND (i.authority_kind='legacy' OR
        (i.authority_kind='organization' AND i.organization_id=?))
      AND NOT EXISTS(SELECT 1 FROM federation_saml_links s WHERE s.identity_id=i.id)`,
    [row.id, settings.config.saml?.entityId ?? "", organizationId]));
    let unlinkBlocked: string | null = null;
    if (row.suspended || row.deleted_at) unlinkBlocked = "Account must be active.";
    else if (row.managed_by && (row.managed_by !== organizationId || !await bound.db.get(
      "SELECT id FROM managed_acceptances WHERE user_id=? AND organization_id=? AND state='accepted'", [row.id, organizationId])))
      unlinkBlocked = "Current accepted management by this organization is required.";
    else if (!row.password_hash || !await bound.db.get(
      "SELECT id FROM verified_emails WHERE user_id=? AND lower(email)=lower(?)", [row.id, row.primary_email]))
      unlinkBlocked = "Set an independent password and verify the primary email first.";
    else if (!await passwordAllowed(bound, row.id, bound.db)) unlinkBlocked = "Deployment policy must permit independent password login.";
    items.push({ userId: row.id, name: row.name, email: row.primary_email, linked, unproven, unlinkBlocked });
  }
  return { configured, version: settings.config.version,
    snapshot: hash(JSON.stringify([settings.config.version, rows.map(row => [row.id, row.version, row.member_version]), items])), items };
}

export function registerSamlAdministration(services: FederationServices) {
  const { context, configurations } = services;
  const repository = store(context);
  const auth = authentication(context, repository);
  context.routes.register(endpoints.samlLinks, async ({ params }, request) => {
    const principal = await auth.port.require(request.request);
    const result = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const bound = { ...context, db: tx };
      await authorize(bound, principal, { organizationId: params.o, level: "admin" });
      return status(services, bound, params.o);
    });
    request.responseHeaders.set("cache-control", "private, no-store");
    request.responseHeaders.set("etag", resourceVersionTag(result.version));
    return result;
  });
  context.routes.register(endpoints.samlLinksAction, async ({ params, body }, request) => {
    const principal = await auth.mutation(request.request);
    const result = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const bound = { ...context, db: tx };
      const active = await tx.get(`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND s.created_at>?
        AND u.suspended=0 AND u.deleted_at IS NULL`,
      [principal.sessionId, principal.user.id, context.clock.now(),
        new Date(Date.parse(context.clock.now()) - 900_000).toISOString()]);
      if (!active) throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Sign in again before this action");
      // Re-read operator authority as well as organization membership under the accounts lock.
      const current = await repository.find(principal.user.id, tx);
      await authorize(bound, { ...principal, operator: current.operator === 1 }, { organizationId: params.o, level: "admin" });
      if (params.o !== configurations.deployment.organizationId)
        throw new ServiceError("SAML_ORGANIZATION_REQUIRED", 409, "This organization does not own the SAML adapter");
      return repository.idempotent(tx, { actor: principal.user.id, route: endpoints.samlLinksAction.path,
        key: request.request.headers.get("idempotency-key") ?? "", body: { params, body },
        schema: endpoints.samlLinksAction.output }, async () => {
        const view = await status(services, bound, params.o);
        if (!view.configured) throw new ServiceError("SAML_UNCONFIGURED", 409, "Select and configure SAML first");
        if (view.version !== body.expectedVersion || view.snapshot !== body.snapshot)
          throw new ServiceError("VERSION_CONFLICT", 409, "SAML links changed; refresh and retry");
        if ((body.action === "unlink-all") === Boolean(body.userId))
          throw new ServiceError("INVALID_INPUT", 400, "Choose one account, or unlink all without an account");
        const targets = body.action === "unlink-all" ? view.items.filter(item => item.linked) :
          view.items.filter(item => item.userId === body.userId);
        if (body.action !== "unlink-all" && targets.length !== 1)
          throw new ServiceError("NOT_FOUND", 404, "Organization member not found");
        if (body.action === "remind") {
          const target = targets[0];
          if (!target || target.linked || target.unproven)
            throw new ServiceError("SAML_ALREADY_LINKED", 409, "Only unlinked members can be reminded");
          const id = newId();
          await tx.run(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at)
            VALUES(?,?,?,?,?,'local',?)`, [id, target.email, "Link your institutional SAML identity",
            `Sign in to your existing Quire account, then explicitly link Institutional SAML at ${new URL("/settings/identities", context.config.publicUrl).href}. This reminder does not sign you in or change your account.`,
            `saml-reminder:${id}`, context.clock.now()]);
        } else {
          for (const target of targets) {
            if (!target.linked) throw new ServiceError("SAML_NOT_LINKED", 409, "No proven SAML link");
            if (target.unlinkBlocked) throw new ServiceError("RECOVERY_REQUIRED", 409, target.unlinkBlocked);
          }
          for (const target of targets) {
            await tx.run(`DELETE FROM identities WHERE user_id=? AND authority_kind='organization' AND organization_id=?
              AND id IN (SELECT identity_id FROM federation_saml_links)`, [target.userId, params.o]);
            await tx.run("UPDATE users SET version=version+1,updated_at=? WHERE id=?", [context.clock.now(), target.userId]);
            await tx.run(`INSERT INTO federation_saml_relinks(user_id,organization_id,account_version)
              SELECT id,managed_by,version FROM users WHERE id=? AND managed_by=?
              ON CONFLICT(user_id) DO UPDATE SET organization_id=excluded.organization_id,account_version=excluded.account_version`,
            [target.userId, params.o]);
            await revokeSessions(bound, target.userId);
          }
          // Both state consumption and admission's publication fence use this version.
          // Increment directly: unlink must not reapply federation provisioning.
          await tx.run("UPDATE federation_configuration SET version=version+1 WHERE id=1");
        }
        await audit(bound, principal, { organizationId: params.o, event: `saml.${body.action}`,
          targetId: body.userId ?? params.o, details: { affected: targets.length } });
        return { version: view.version + (body.action === "remind" ? 0 : 1),
          affected: targets.length, queued: body.action === "remind" ? 1 : 0,
          signedOut: body.action !== "remind" && targets.some(target => target.userId === principal.user.id) };
      });
    });
    await context.events.dispatch();
    return result;
  });
}
