import ky from "ky";
import { z } from "zod";
import { endpoints, resourceVersionTag, IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { SecretBox } from "../../adapters/shared/secrets";
import { currentOperator, operator } from "./access";

const Settings = z.object({
  endpoint: z.string(), encrypted_secret: z.instanceof(Uint8Array).nullable(), enabled: z.number(),
  authorized_by: IdSchema, version: z.number(), cursor: z.number(), attempts: z.number(),
  retry_at: z.string().nullable(), lease_owner: z.string().nullable(), lease_until: z.string().nullable(),
});
const Audit = z.object({ seq: z.number(), id: IdSchema, at: z.string(), event: z.string() });

export function registerSiem(context: ModuleContext): void {
  context.routes.register(endpoints.auditSiemGet, async (_input, request) => {
    await operator(context, request.request);
    const row = Settings.nullable().parse(await context.db.get("SELECT * FROM support_siem WHERE id=1"));
    request.responseHeaders.set("etag", resourceVersionTag(row?.version ?? 0));
    return { endpoint: row?.endpoint ?? "", secretPresent: row?.encrypted_secret !== null && row !== null,
      enabled: row?.enabled === 1, version: row?.version ?? 0 };
  });
  context.routes.register(endpoints.auditSiem, async (input, request) => {
    const principal = await operator(context, request.request);
    const endpoint = new URL(input.body.endpoint);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || (endpoint.protocol !== "https:" &&
        (context.config.production || !["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname)))) {
      throw new ServiceError("SIEM_ENDPOINT_INVALID", 400, "Use HTTPS without URL credentials, query or fragment; development HTTP is loopback-only");
    }
    const version = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await currentOperator(tx, principal.user.id);
      const old = Settings.nullable().parse(await tx.get("SELECT * FROM support_siem WHERE id=1"));
      if (input.body.expectedVersion !== (old?.version ?? 0) ||
        request.request.headers.get("if-match") !== resourceVersionTag(old?.version ?? 0)) {
        throw new ServiceError("VERSION_CONFLICT", 409, "SIEM configuration changed");
      }
      const secret = input.body.secret === undefined ? old?.encrypted_secret ?? null
        : input.body.secret === "" ? null : new SecretBox(context.secretKey).seal(
          z.string().max(8192).parse(input.body.secret), "support:siem");
      if (input.body.enabled && !secret) throw new ServiceError("SIEM_SECRET_REQUIRED", 400, "Configure a delivery credential before enabling SIEM");
      const next = (old?.version ?? 0) + 1;
      const now = context.clock.now();
      await tx.run(`INSERT INTO support_siem
        (id,endpoint,encrypted_secret,enabled,authorized_by,version,updated_at)
        VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,
        encrypted_secret=excluded.encrypted_secret,enabled=excluded.enabled,authorized_by=excluded.authorized_by,
        version=excluded.version,attempts=0,retry_at=NULL,last_error=NULL,lease_owner=NULL,lease_until=NULL,updated_at=excluded.updated_at`,
      [endpoint.href, secret, Number(input.body.enabled), principal.user.id, next, now]);
      await tx.run(`INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json)
        VALUES(?,?,?,?,?,?)`, [crypto.randomUUID(), now, principal.user.id, "support.siem.configured",
        principal.user.id, JSON.stringify({ enabled: input.body.enabled, version: next })]);
      return next;
    });
    request.responseHeaders.set("etag", resourceVersionTag(version));
    return { ok: true as const, version };
  });
}

/**
 * One ordered event per admission. Network I/O never holds a SQL transaction.
 * A remote receiver must durably dedupe Idempotency-Key before acknowledging.
 */
export async function dispatchSiem(context: Omit<ModuleContext, "routes">): Promise<"idle" | "delivered" | "retry"> {
  const owner = crypto.randomUUID();
  const claimed = await context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    const row = Settings.nullable().parse(await tx.get("SELECT * FROM support_siem WHERE id=1"));
    if (!row || row.enabled !== 1 || !row.encrypted_secret ||
      (row.retry_at && row.retry_at > context.clock.now()) ||
      (row.lease_until && row.lease_until > context.clock.now())) return null;
    const authorized = z.object({ operator: z.number(), suspended: z.number(), deleted_at: z.string().nullable() })
      .nullable().parse(await tx.get("SELECT operator,suspended,deleted_at FROM users WHERE id=?", [row.authorized_by]));
    if (!authorized || authorized.operator !== 1 || authorized.suspended !== 0 || authorized.deleted_at !== null) return null;
    const event = Audit.nullable().parse(await tx.get(
      "SELECT seq,id,at,event FROM audit_entries WHERE seq>? ORDER BY seq LIMIT 1", [row.cursor]));
    if (!event) return null;
    await tx.run("UPDATE support_siem SET lease_owner=?,lease_until=? WHERE id=1",
      [owner, new Date(Date.parse(context.clock.now()) + 30000).toISOString()]);
    return { settings: row, event };
  });
  if (!claimed) return "idle";
  const { settings, event } = claimed;
  let failure: string | null = null;
  try {
    // Re-read immediately before dispatch: disables, credential rotation and operator revocation fence stale claims.
    const current = await context.db.get(`SELECT 1 FROM support_siem s JOIN users u ON u.id=s.authorized_by
      WHERE s.id=1 AND s.version=? AND s.enabled=1 AND s.lease_owner=?
      AND u.operator=1 AND u.suspended=0 AND u.deleted_at IS NULL`, [settings.version, owner]);
    if (!current) return "idle";
    const credential = new SecretBox(context.secretKey).open(z.instanceof(Uint8Array).parse(settings.encrypted_secret), "support:siem");
    const response = await ky.post(settings.endpoint, {
      headers: { authorization: `Bearer ${credential}`, "idempotency-key": `quire-audit-${event.id}` },
      json: { format: "quire-audit-v1", ...event }, redirect: "error", retry: 0, timeout: 5000,
    });
    await response.body?.cancel();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // Boundary failure is intentionally categorical; response/error text may expose credentials or private URLs.
    failure = "SIEM_DELIVERY_FAILED";
  }
  const advanced = await context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    const result = await tx.run(`UPDATE support_siem SET cursor=?,attempts=?,retry_at=?,last_error=?,
      lease_owner=NULL,lease_until=NULL WHERE id=1 AND version=? AND lease_owner=? AND cursor=?`,
    [failure ? settings.cursor : event.seq, failure ? settings.attempts + 1 : 0,
      failure ? new Date(Date.parse(context.clock.now()) + Math.min(300000, 1000 * 2 ** Math.min(settings.attempts, 9))).toISOString() : null,
      failure, settings.version, owner, settings.cursor]);
    return result.changes === 1;
  });
  return failure || !advanced ? "retry" : "delivered";
}
