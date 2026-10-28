import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { IdentityPort, ModuleContext, Principal, RequestContext, Transaction } from "@quire/runtime";
import { hash, newId, secret } from "./store";
import type { IdentityStore } from "./store";
import { requireEnrolledBreakGlass } from "./reads";

export const sessionCookie = "quire_session";
export function requireOrigin(context: ModuleContext, request: Request): void {
  if (request.headers.get("origin") !== new URL(context.config.publicUrl).origin ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ServiceError("ORIGIN_DENIED", 403, "Same-origin request required");
  }
}
function cookie(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${sessionCookie}=`));
  return values.length === 1 ? values[0]?.slice(sessionCookie.length + 1) ?? null : null;
}
export function authentication(context: ModuleContext, repository: IdentityStore) {
  const { db, clock } = context;
  const csrf = (token: string) => createHmac("sha256", context.secretKey).update(`csrf:${token}`).digest("base64url");
  const cookieValue = (token: string, age: number) =>
    `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(context.config.publicUrl).protocol === "https:" ? "; Secure" : ""}`;
  const port: IdentityPort = {
    async authenticate(request) {
      const token = cookie(request);
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      return context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        const value = (await tx.get("SELECT s.id,s.user_id,s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at IS NULL AND u.suspended=0", [hash(token), clock.now()]));
        if (!value) return null;
        const row = z.object({ id: IdSchema, user_id: IdSchema, csrf_hash: z.string() }).parse(value);
        const csrfToken = csrf(token);
        if (hash(csrfToken) !== row.csrf_hash) return null;
        await tx.run("UPDATE sessions SET last_seen_at=? WHERE id=?", [clock.now(), row.id]);
        return { user: (await repository.user(row.user_id, tx)), sessionId: row.id, csrfToken,
          operator: (await repository.find(row.user_id, tx)).operator === 1 };
      });
    },
    async require(request) {
      const principal = await port.authenticate(request);
      if (!principal) throw new ServiceError("UNAUTHENTICATED", 401, "Authentication required");
      return principal;
    },
    async verifyMutation(request, principal) {
      requireOrigin(context, request);
      const supplied = Buffer.from(request.headers.get("x-csrf-token") ?? "");
      const expected = Buffer.from(principal.csrfToken);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new ServiceError("CSRF_DENIED", 403, "Valid CSRF token required");
      }
      const current = await port.require(request);
      if (current.sessionId !== principal.sessionId) throw new ServiceError("UNAUTHENTICATED", 401, "Session changed");
    },
  };
  async function mutation(request: Request): Promise<Principal> {
    const principal = await port.require(request);
    await port.verifyMutation(request, principal);
    return principal;
  }
  function prepareIssue(request: RequestContext) {
    const token = secret();
    const now = clock.now();
    const old = cookie(request.request);
    async function publish(tx: Transaction, userId: Id) {
      await tx.lock("quire:accounts");

      await repository.find(userId, tx);
      if (old) {
        const removed = z.array(z.object({ id: IdSchema, user_id: IdSchema })).parse(
          (await tx.all("DELETE FROM sessions WHERE token_hash=? RETURNING id,user_id", [hash(old)])));
        for (const session of removed) {
          await context.events.record(tx, { topic: "session.revoked", aggregateId: session.user_id,
            payload: { userId: session.user_id, sessionId: session.id } });
        }
      }
      await tx.run("INSERT INTO sessions(id,user_id,token_hash,csrf_hash,created_at,expires_at,last_seen_at,user_agent) VALUES(?,?,?,?,?,?,?,?)", [newId(), userId, hash(token), hash(csrf(token)), now, new Date(Date.parse(now) + 7 * 86400_000).toISOString(), now, (request.request.headers.get("user-agent") ?? "").slice(0, 1024)]);
    }
    async function complete() {
      await context.events.dispatch();
      request.responseHeaders.append("set-cookie", cookieValue(token, 7 * 86400));
    }
    return { publish, complete };
  }
  async function issue(userId: Id, request: RequestContext, authorize?: (tx: Transaction) => Promise<void>) {
    const prepared = prepareIssue(request);
    await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      await authorize?.(tx);
      await prepared.publish(tx, userId);
    });
    await prepared.complete();
  }
  function clear(request: RequestContext) {
    request.responseHeaders.append("set-cookie", cookieValue("", 0));
  }
  async function fresh(principal: Principal) {
    const row = z.object({ created_at: z.string() }).parse(
      (await db.get("SELECT created_at FROM sessions WHERE id=?", [principal.sessionId])));
    if (Date.parse(clock.now()) - Date.parse(row.created_at) > 15 * 60_000) {
      throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Sign in again before this action");
    }
  }
  return { port, mutation, issue, prepareIssue, clear, fresh };
}
export type Authentication = ReturnType<typeof authentication>;

export async function enrollBreakGlass(context: ModuleContext, input: {
  readonly principal: Principal; readonly password: string;
}): Promise<void> {
  const value = z.object({ password_hash: z.string().nullable() }).parse(
    await context.db.get("SELECT password_hash FROM users WHERE id=?", [input.principal.user.id]));
  if (!value.password_hash || !await Bun.password.verify(input.password, value.password_hash)) {
    throw new ServiceError("INVALID_CREDENTIALS", 401, "Current password required for break-glass enrollment");
  }
  await context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    const active = await tx.get(`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND s.created_at>? AND u.operator=1
      AND u.suspended=0 AND u.deleted_at IS NULL AND u.password_hash=?`,
    [input.principal.sessionId, input.principal.user.id, context.clock.now(),
      new Date(Date.parse(context.clock.now()) - 15 * 60_000).toISOString(), value.password_hash]);
    if (!active) throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Fresh active operator session required");
    await tx.run("INSERT INTO identity_breakglass(user_id,enrolled_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET enrolled_at=excluded.enrolled_at",
      [input.principal.user.id, context.clock.now()]);
    await requireEnrolledBreakGlass(context, input.principal.user.id, tx);
    await tx.run("INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
      [newId(), context.clock.now(), input.principal.user.id, "identity.breakglass.enrolled", input.principal.user.id, "{}"]);
  });
}
