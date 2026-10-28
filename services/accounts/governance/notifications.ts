import type { TransactionContext } from "./shared";
import { z } from "zod";
import { endpoints, IdSchema, InstantSchema, NotificationPreferencesSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { conflict, missing, newId, page, route } from "./shared";

export async function notificationPreferences(context: ModuleContext, userId: Id) {
  const value = (await context.db.get("SELECT * FROM notification_preferences WHERE user_id=?", [userId]));
  if (!value) return NotificationPreferencesSchema.parse({ events: {}, channels: ["in-app", "email"], projectOverrides: {}, version: 0 });
  const row = z.object({ events_json: z.string(), channels_json: z.string(), project_overrides_json: z.string(), version: z.number() }).parse(value);
  return NotificationPreferencesSchema.parse({ events: JSON.parse(row.events_json), channels: JSON.parse(row.channels_json),
    projectOverrides: JSON.parse(row.project_overrides_json), version: row.version });
}
export type NotificationInput = {
  readonly userId: Id; readonly kind: string; readonly resourceId: Id; readonly projectId?: Id;
  readonly dedupeKey: string; readonly mail: { readonly subject: string; readonly body: string; readonly digestAt?: string };
};
// Called inside the producer's unit of work; no network or dispatch before commit.
export async function enqueueNotification(context: TransactionContext, input: NotificationInput): Promise<Id | null> {
  await context.db.lock("quire:accounts");
  const { clock } = context;
  const inserted = (await context.db.run("INSERT INTO governance_notification_receipts(user_id,dedupe_key,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING", [input.userId, input.dedupeKey, clock.now()])).changes;
  if (inserted === 0) return null;
  const preferences = (await notificationPreferences(context, input.userId));
  const enabled = (input.projectId ? preferences.projectOverrides[input.projectId]?.[input.kind] : undefined)
    ?? preferences.events[input.kind] ?? true;
  if (!enabled) return null;
  let notificationId: Id | null = null;
  if (preferences.channels.includes("in-app")) {
    notificationId = newId();
    await context.db.run("INSERT INTO notifications(id,user_id,kind,resource_id,created_at) VALUES(?,?,?,?,?)", [notificationId, input.userId, input.kind, input.resourceId, clock.now()]);
    await context.events.record(context.db, { topic: "notification.created", aggregateId: input.userId,
      payload: { resourceId: notificationId, version: 0 } });
  }
  if (preferences.channels.includes("email")) {
    const value = (await context.db.get("SELECT primary_email FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL", [input.userId]));
    if (!value) return notificationId;
    const recipient = z.object({ primary_email: z.string() }).parse(value).primary_email;
    if (input.mail.digestAt) {
      await context.db.run("INSERT INTO governance_digest_items(id,user_id,kind,project_id,resource_id,subject,body,due_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)", [newId(), input.userId, input.kind, input.projectId ?? null, input.resourceId, input.mail.subject, input.mail.body, InstantSchema.parse(input.mail.digestAt), clock.now()]);
    } else {
      await context.db.run("INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at) VALUES(?,?,?,?,?,'local',?)", [newId(), recipient, input.mail.subject, input.mail.body, `governance:${input.userId}:${input.dedupeKey}`, clock.now()]);
    }
  }
  return notificationId;
}
export async function flushNotificationDigests(context: ModuleContext): Promise<number> {
  return await context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    const bound = { ...context, db: tx };

    const rows = z.array(z.object({ user_id: IdSchema, due_at: z.string() })).parse((await bound.db.all("SELECT DISTINCT user_id,due_at FROM governance_digest_items WHERE due_at<=? AND sent_at IS NULL ORDER BY due_at,user_id", [bound.clock.now()])));
    let count = 0;
    for (const row of rows) {
      const preferences = (await notificationPreferences(bound, row.user_id));
      const candidates = z.array(z.object({ kind: z.string(), project_id: IdSchema.nullable(), subject: z.string(), body: z.string() })).parse(
        (await bound.db.all("SELECT kind,project_id,subject,body FROM governance_digest_items WHERE user_id=? AND due_at=? AND sent_at IS NULL ORDER BY id", [row.user_id, row.due_at])));
      const items = [];
      for (const item of candidates) {
        const enabled = (item.project_id ? preferences.projectOverrides[item.project_id]?.[item.kind] : undefined)
          ?? preferences.events[item.kind] ?? true;
        if (enabled && (item.project_id === null || Boolean((await bound.db.get("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL AND (owner_id=? OR EXISTS(SELECT 1 FROM project_members WHERE project_id=? AND user_id=?))", [item.project_id, row.user_id, item.project_id, row.user_id]))))) items.push(item);
      }
      const value = (await bound.db.get("SELECT primary_email FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL", [row.user_id]));
      if (items.length && value && preferences.channels.includes("email")) {
        const recipient = z.object({ primary_email: z.string() }).parse(value).primary_email;
        count += (await bound.db.run("INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at) VALUES(?,?,'Quire digest',?,?,'local',?) ON CONFLICT DO NOTHING", [newId(), recipient, items.map((item) => `${item.subject}\n${item.body}`).join("\n\n"), `governance-digest:${row.user_id}:${row.due_at}`, bound.clock.now()])).changes;
      }
      await bound.db.run("UPDATE governance_digest_items SET sent_at=? WHERE user_id=? AND due_at=? AND sent_at IS NULL", [bound.clock.now(), row.user_id, row.due_at]);
    }
    return count;
  });
}
export function registerNotifications(context: ModuleContext): void {
  route(context, endpoints.notificationsList, async ({ query }, principal, _request, bound) => {
    const rows = z.array(z.object({ id: IdSchema, kind: z.string(), resource_id: IdSchema,
      read_at: z.string().nullable(), created_at: InstantSchema, version: z.number() })).parse((await bound.db.all("SELECT * FROM notifications WHERE user_id=? AND id>? ORDER BY id LIMIT ?", [principal.user.id, query.cursor ?? "", query.limit + 1])));
    return page(rows.map((row) => ({ id: row.id, kind: row.kind, resourceId: row.resource_id,
      read: row.read_at !== null, createdAt: row.created_at, version: row.version })), query.limit);
  });
  route(context, endpoints.notificationRead, async ({ params, body }, principal, _request, bound) => {
    const value = (await bound.db.get("SELECT version FROM notifications WHERE id=? AND user_id=?", [params.id, principal.user.id]));
    if (!value) throw missing();
    conflict(z.object({ version: z.number() }).parse(value).version, body.expectedVersion);
    await bound.db.run("UPDATE notifications SET read_at=?,version=version+1 WHERE id=?", [bound.clock.now(), params.id]);
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
  route(context, endpoints.notificationPreferencesGet, async (_input, principal, request, bound) => {
    const preferences = (await notificationPreferences(bound, principal.user.id));
    request.responseHeaders.set("etag", `"v${preferences.version}"`);
    return preferences;
  });
  route(context, endpoints.notificationPreferences, async ({ body }, principal, _request, bound) => {
    const preferences = (await notificationPreferences(bound, principal.user.id));
    conflict(preferences.version, body.expectedVersion);
    await bound.db.run("INSERT INTO notification_preferences(user_id,events_json,channels_json,project_overrides_json,version,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET events_json=excluded.events_json,channels_json=excluded.channels_json,project_overrides_json=excluded.project_overrides_json,version=excluded.version,updated_at=excluded.updated_at", [principal.user.id, JSON.stringify(body.events), JSON.stringify(body.channels), JSON.stringify(body.projectOverrides), body.expectedVersion + 1, bound.clock.now()]);
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
}
