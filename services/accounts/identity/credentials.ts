import { z } from "zod";
import { endpoints, IdSchema, resourceVersionTag, SessionSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { defaultPreferences, hashPassword, newId, secret, userRow } from "./store";
import type { IdentityStore } from "./store";
import { requireOrigin } from "./authentication";
import type { Authentication } from "./authentication";

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
    repository.limit("register", body.email.toLowerCase());
    const email = body.email.toLowerCase();
    const password = await hashPassword(body.password);
    return uow.local(() => repository.idempotent({
      actor: "public", route: "register", key: request.request.headers.get("idempotency-key") ?? "",
      body, schema: z.strictObject({ verificationRequired: z.boolean() }),
    }, () => {
      if (db.query("SELECT id FROM users WHERE primary_email=? UNION SELECT user_id FROM verified_emails WHERE email=?").get(email, email)) {
        return { verificationRequired: true };
      }
      const id = newId();
      const now = clock.now();
      db.query("INSERT INTO users(id,name,primary_email,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .run(id, body.name, email, password, now, now);
      db.query("INSERT INTO preferences(user_id,value_json,updated_at) VALUES(?,?,?)").run(id, JSON.stringify(defaultPreferences), now);
      repository.mail({ userId: id, email, purpose: "verify" });
      return { verificationRequired: true };
    }));
  });
  routes.register(endpoints.authVerifyEmail, ({ body }, request) => {
    requireOrigin(context, request.request);
    repository.limit("verify", body.token);
    return uow.local(() => {
      const token = repository.token(body.token, "verify");
      repository.find(token.user_id);
      const { email } = z.object({ email: z.email() }).parse(JSON.parse(token.payload_json));
      const exists = db.query("SELECT id FROM verified_emails WHERE email=? UNION SELECT id FROM users WHERE primary_email=? AND id<>?")
        .get(email, email, token.user_id);
      if (exists) throw new ServiceError("EMAIL_UNAVAILABLE", 409, "Email is unavailable");
      repository.consume(token.id);
      db.query("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)")
        .run(newId(), token.user_id, email, clock.now());
      const version = repository.version(token.user_id, repository.find(token.user_id).version);
      request.responseHeaders.set("etag", resourceVersionTag(version));
      return { ok: true, version };
    });
  });
  routes.register(endpoints.authLogin, async ({ body }, request) => {
    requireOrigin(context, request.request);
    repository.limit("login", body.email.toLowerCase());
    const value = db.query("SELECT * FROM users WHERE primary_email=? AND suspended=0 AND deleted_at IS NULL").get(body.email.toLowerCase());
    const row = value ? userRow.parse(value) : null;
    const valid = await Bun.password.verify(body.password, row?.password_hash ?? await dummyHash);
    if (!valid || !row) throw new ServiceError("INVALID_CREDENTIALS", 401, "Email or password is incorrect");
    if (!db.query("SELECT id FROM verified_emails WHERE user_id=? AND email=?").get(row.id, row.primary_email)) {
      throw new ServiceError("EMAIL_VERIFICATION_REQUIRED", 403, "Verify your primary email first");
    }
    auth.issue(row.id, request);
    request.responseHeaders.set("etag", resourceVersionTag(row.version));
    return repository.user(row.id);
  });
  routes.register(endpoints.authLogout, async (_input, request) => {
    const principal = await auth.mutation(request.request);
    uow.local((tx) => {
      db.query("DELETE FROM sessions WHERE id=?").run(principal.sessionId);
      context.events.append(tx, { topic: "session.revoked", aggregateId: principal.user.id,
        payload: { userId: principal.user.id, sessionId: principal.sessionId } });
    });
    context.events.dispatch();
    auth.clear(request);
    return { ok: true as const, version: 0 };
  });
  routes.register(endpoints.me, async (_input, request) => {
    const principal = await auth.port.require(request.request);
    request.responseHeaders.set("etag", resourceVersionTag(repository.find(principal.user.id).version));
    return { user: principal.user, preferences: repository.preferences(principal.user.id),
      capabilities: { localIdentity: { enabled: true, state: "ready" } },
      csrfToken: principal.csrfToken } as const;
  });
  routes.register(endpoints.passwordReset, ({ body }, request) => {
    requireOrigin(context, request.request);
    repository.limit("reset", body.email.toLowerCase());
    const email = body.email.toLowerCase();
    uow.local(() => {
      const value = db.query("SELECT * FROM users WHERE primary_email=? AND suspended=0 AND deleted_at IS NULL").get(email);
      if (value) {
        const row = userRow.parse(value);
        if (row.managed_by === null && row.password_hash !== null) repository.mail({ userId: row.id, email, purpose: "reset" });
      }
    });
    return { ok: true as const, version: 0 };
  });
  routes.register(endpoints.passwordResetConfirm, async ({ body }, request) => {
    requireOrigin(context, request.request);
    repository.limit("reset-confirm", body.token);
    repository.token(body.token, "reset");
    const password = await hashPassword(body.password);
    const result = uow.local((tx) => {
      const token = repository.token(body.token, "reset");
      const user = repository.find(token.user_id);
      if (user.managed_by !== null) throw new ServiceError("MANAGED_ACCOUNT", 403, "Contact the managing organization");
      repository.consume(token.id);
      const version = repository.version(user.id, user.version);
      db.query("UPDATE users SET password_hash=? WHERE id=?").run(password, user.id);
      db.query("DELETE FROM sessions WHERE user_id=?").run(user.id);
      context.events.append(tx, { topic: "session.revoked", aggregateId: user.id,
        payload: { userId: user.id, sessionId: null } });
      db.query("UPDATE one_time_tokens SET used_at=? WHERE user_id=? AND purpose='reset' AND used_at IS NULL").run(clock.now(), user.id);
      return { ok: true as const, version };
    });
    context.events.dispatch();
    auth.clear(request);
    return result;
  });
  routes.register(endpoints.sessionList, async ({ query }, request) => {
    const principal = await auth.port.require(request.request);
    const rows = z.array(z.object({
      id: z.string(), created_at: z.string(), expires_at: z.string(), last_seen_at: z.string(),
      user_agent: z.string(), ip: z.string().nullable(), version: z.number(),
    })).parse(db.query("SELECT * FROM sessions WHERE user_id=? AND expires_at>? AND id>? ORDER BY id LIMIT ?")
      .all(principal.user.id, clock.now(), query.cursor ?? "", query.limit + 1));
    const page = rows.slice(0, query.limit);
    return { items: page.map((row) => SessionSchema.parse({
      id: row.id, createdAt: row.created_at, expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at, current: row.id === principal.sessionId, userAgent: row.user_agent, ip: row.ip,
      version: row.version,
    })), nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null };
  });
  routes.register(endpoints.sessionDelete, async ({ params, body }, request) => {
    const principal = await auth.mutation(request.request);
    uow.local((tx) => {
      if (db.query("DELETE FROM sessions WHERE id=? AND user_id=? AND version=?")
        .run(params.id, principal.user.id, body.expectedVersion).changes !== 1) {
        throw new ServiceError("VERSION_CONFLICT", 409, "Session is missing or changed");
      }
      context.events.append(tx, { topic: "session.revoked", aggregateId: principal.user.id,
        payload: { userId: principal.user.id, sessionId: params.id } });
    });
    context.events.dispatch();
    if (params.id === principal.sessionId) auth.clear(request);
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
  routes.register(endpoints.sessionRevokeOthers, async (_input, request) => {
    const principal = await auth.mutation(request.request);
    uow.local((tx) => {
      const removed = z.array(z.object({ id: IdSchema })).parse(
        db.query("DELETE FROM sessions WHERE user_id=? AND id<>? RETURNING id").all(principal.user.id, principal.sessionId));
      for (const session of removed) {
        context.events.append(tx, { topic: "session.revoked", aggregateId: principal.user.id,
          payload: { userId: principal.user.id, sessionId: session.id } });
      }
    });
    context.events.dispatch();
    return { ok: true as const, version: 0 };
  });
}
