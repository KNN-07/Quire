import { z } from "zod";
import { endpoints, IdSchema, resourceVersionTag, SessionSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { defaultPreferences, hashPassword, newId, secret, userRow } from "./store";
import type { IdentityStore } from "./store";
import { requireOrigin } from "./authentication";
import type { Authentication } from "./authentication";
import { identityPolicy, passwordAllowed } from "./reads";

export type IdentityDependencies = {
  readonly repository: IdentityStore;
  readonly auth: Authentication;
};
export function registerCredentials(context: ModuleContext, dependencies: IdentityDependencies): void {
  const { db, uow, clock, routes } = context;
  const { repository, auth } = dependencies;
  const dummyHash = hashPassword(secret());
  routes.register(endpoints.authRegister, async ({ body }, request) => {
    requireOrigin(context, request.request);
    await repository.limit("register", body.email.toLowerCase());
    const email = body.email.toLowerCase();
    const password = await hashPassword(body.password);
    return await uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      if ((await identityPolicy(context, tx)).requireSso) throw new ServiceError("SSO_REQUIRED", 403, "Use the configured identity provider");
      return await repository.idempotent(tx, {
        actor: "public", route: "register", key: request.request.headers.get("idempotency-key") ?? "",
        body, schema: z.strictObject({ verificationRequired: z.boolean() }),
      }, async () => {
        if ((await tx.get("SELECT id FROM users WHERE lower(primary_email)=lower(?) UNION SELECT user_id FROM verified_emails WHERE lower(email)=lower(?)", [email, email]))) {
          return { verificationRequired: true };
        }
        const id = newId();
        const now = clock.now();
        await tx.run("INSERT INTO users(id,name,primary_email,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)", [id, body.name, email, password, now, now]);
        await tx.run("INSERT INTO preferences(user_id,value_json,updated_at) VALUES(?,?,?)", [id, JSON.stringify(defaultPreferences), now]);
        await repository.mail(tx, { userId: id, email, purpose: "verify" });
        return { verificationRequired: true };
      });
    });
  });
  routes.register(endpoints.authVerifyEmail, async ({ body }, request) => {
    requireOrigin(context, request.request);
    await repository.limit("verify", body.token);
    return await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const token = await repository.token(body.token, "verify", tx);
      await repository.find(token.user_id, tx);
      const { email } = z.object({ email: z.email() }).parse(JSON.parse(token.payload_json));
      const exists = (await tx.get("SELECT id FROM verified_emails WHERE lower(email)=lower(?) UNION SELECT id FROM users WHERE lower(primary_email)=lower(?) AND id<>?", [email, email, token.user_id]));
      if (exists) throw new ServiceError("EMAIL_UNAVAILABLE", 409, "Email is unavailable");
      await repository.consume(tx, token.id);
      await tx.run("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)", [newId(), token.user_id, email, clock.now()]);
      const version = await repository.version(tx, token.user_id, (await repository.find(token.user_id, tx)).version);
      request.responseHeaders.set("etag", resourceVersionTag(version));
      return { ok: true, version };
    });
  });
  routes.register(endpoints.authLogin, async ({ body }, request) => {
    requireOrigin(context, request.request);
    await repository.limit("login", body.email.toLowerCase());
    const value = (await db.get("SELECT * FROM users WHERE lower(primary_email)=lower(?) AND suspended=0 AND deleted_at IS NULL", [body.email.toLowerCase()]));
    const row = value ? userRow.parse(value) : null;
    const valid = await Bun.password.verify(body.password, row?.password_hash ?? await dummyHash);
    if (!valid || !row) throw new ServiceError("INVALID_CREDENTIALS", 401, "Email or password is incorrect");
    if (!(await db.get("SELECT id FROM verified_emails WHERE user_id=? AND lower(email)=lower(?)", [row.id, row.primary_email]))) {
      throw new ServiceError("EMAIL_VERIFICATION_REQUIRED", 403, "Verify your primary email first");
    }
    await auth.issue(row.id, request, async (tx) => {
      const current = await repository.find(row.id, tx);
      if (current.password_hash !== row.password_hash) throw new ServiceError("INVALID_CREDENTIALS", 401, "Credentials changed");
      if (!await passwordAllowed(context, row.id, tx)) throw new ServiceError("SSO_REQUIRED", 403, "Use the configured identity provider");
    });
    request.responseHeaders.set("etag", resourceVersionTag(row.version));
    return (await repository.user(row.id));
  });
  routes.register(endpoints.authLogout, async (_input, request) => {
    const principal = await auth.mutation(request.request);
    await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      await tx.run("DELETE FROM sessions WHERE id=?", [principal.sessionId]);
      await context.events.record(tx, { topic: "session.revoked", aggregateId: principal.user.id,
        payload: { userId: principal.user.id, sessionId: principal.sessionId } });
    });
    await context.events.dispatch();
    auth.clear(request);
    return { ok: true as const, version: 0 };
  });
  routes.register(endpoints.me, async (_input, request) => {
    const principal = await auth.port.require(request.request);
    request.responseHeaders.set("etag", resourceVersionTag((await repository.find(principal.user.id)).version));
    return { user: principal.user, preferences: (await repository.preferences(principal.user.id)),
      capabilities: { localIdentity: { enabled: true, state: "ready" } },
      csrfToken: principal.csrfToken } as const;
  });
  routes.register(endpoints.passwordReset, async ({ body }, request) => {
    requireOrigin(context, request.request);
    await repository.limit("reset", body.email.toLowerCase());
    const email = body.email.toLowerCase();
    await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const value = (await tx.get("SELECT * FROM users WHERE lower(primary_email)=lower(?) AND suspended=0 AND deleted_at IS NULL", [email]));
      if (value) {
        const row = userRow.parse(value);
        if (row.managed_by === null && row.password_hash !== null && await passwordAllowed(context, row.id, tx)) {
          await repository.mail(tx, { userId: row.id, email, purpose: "reset" });
        }
      }
    });
    return { ok: true as const, version: 0 };
  });
  routes.register(endpoints.passwordResetConfirm, async ({ body }, request) => {
    requireOrigin(context, request.request);
    await repository.limit("reset-confirm", body.token);
    await repository.token(body.token, "reset");
    const password = await hashPassword(body.password);
    const result = await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const token = await repository.token(body.token, "reset", tx);
      const user = await repository.find(token.user_id, tx);
      if (user.managed_by !== null) throw new ServiceError("MANAGED_ACCOUNT", 403, "Contact the managing organization");
      if (!await passwordAllowed(context, user.id, tx)) throw new ServiceError("SSO_REQUIRED", 403, "Use the configured identity provider");
      await repository.consume(tx, token.id);
      const version = await repository.version(tx, user.id, user.version);
      await tx.run("UPDATE users SET password_hash=? WHERE id=?", [password, user.id]);
      await tx.run("DELETE FROM sessions WHERE user_id=?", [user.id]);
      await context.events.record(tx, { topic: "session.revoked", aggregateId: user.id,
        payload: { userId: user.id, sessionId: null } });
      await tx.run("UPDATE one_time_tokens SET used_at=? WHERE user_id=? AND purpose='reset' AND used_at IS NULL", [clock.now(), user.id]);
      return { ok: true as const, version };
    });
    await context.events.dispatch();
    auth.clear(request);
    return result;
  });
  routes.register(endpoints.sessionList, async ({ query }, request) => {
    const principal = await auth.port.require(request.request);
    const rows = z.array(z.object({
      id: z.string(), created_at: z.string(), expires_at: z.string(), last_seen_at: z.string(),
      user_agent: z.string(), ip: z.string().nullable(), version: z.number(),
    })).parse((await db.all("SELECT * FROM sessions WHERE user_id=? AND expires_at>? AND id>? ORDER BY id LIMIT ?", [principal.user.id, clock.now(), query.cursor ?? "", query.limit + 1])));
    const page = rows.slice(0, query.limit);
    return { items: page.map((row) => SessionSchema.parse({
      id: row.id, createdAt: row.created_at, expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at, current: row.id === principal.sessionId, userAgent: row.user_agent, ip: row.ip,
      version: row.version,
    })), nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null };
  });
  routes.register(endpoints.sessionDelete, async ({ params, body }, request) => {
    const principal = await auth.mutation(request.request);
    await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      if ((await tx.run("DELETE FROM sessions WHERE id=? AND user_id=? AND version=?", [params.id, principal.user.id, body.expectedVersion])).changes !== 1) {
        throw new ServiceError("VERSION_CONFLICT", 409, "Session is missing or changed");
      }
      await context.events.record(tx, { topic: "session.revoked", aggregateId: principal.user.id,
        payload: { userId: principal.user.id, sessionId: params.id } });
    });
    await context.events.dispatch();
    if (params.id === principal.sessionId) auth.clear(request);
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
  routes.register(endpoints.sessionRevokeOthers, async (_input, request) => {
    const principal = await auth.mutation(request.request);
    await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      const removed = z.array(z.object({ id: IdSchema })).parse(
        (await tx.all("DELETE FROM sessions WHERE user_id=? AND id<>? RETURNING id", [principal.user.id, principal.sessionId])));
      for (const session of removed) {
        await context.events.record(tx, { topic: "session.revoked", aggregateId: principal.user.id,
          payload: { userId: principal.user.id, sessionId: session.id } });
      }
    });
    await context.events.dispatch();
    return { ok: true as const, version: 0 };
  });
}
