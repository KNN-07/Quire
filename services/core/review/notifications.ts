import { z } from "zod";
import { IdSchema, assertNever } from "@quire/contracts";
import type { Comment, Id, Scope, Suggestion } from "@quire/contracts";
import type { NotificationInput } from "../../accounts/governance";
import { enqueueNotification, notificationPreferences } from "../../accounts/governance";
import type { SourceFinalization } from "../base";
import { uuid } from "./store";
import type { ReviewStore } from "./store";

type ReviewActivity =
  | { readonly type: "comment"; readonly scope: Scope; readonly comment: Comment; readonly threadId: Id; readonly reply: boolean }
  | { readonly type: "suggestion"; readonly suggestion: Suggestion; readonly actorId: Id; readonly eventId: string };
/** Called only inside the producer's metadata transaction, before outbox dispatch. */
export async function notifyReview(store: ReviewStore, activity: ReviewActivity, finalization?: SourceFinalization): Promise<void> {
  const { context } = store;
  let scope: Scope;
  let actorId: Id;
  let resourceId: Id;
  let eventId: string;
  let body: string;
  let replyAuthors: readonly Id[] = [];
  switch (activity.type) {
    case "comment":
      scope = activity.scope; actorId = activity.comment.authorId;
      resourceId = activity.comment.id; eventId = `comment:${resourceId}`;
      body = activity.comment.body;
      if (activity.reply) replyAuthors = (await context.db.all<{ author_id: Id }>("SELECT DISTINCT author_id FROM comments WHERE thread_id=?", [activity.threadId])).map(row => row.author_id);
      break;
    case "suggestion":
      scope = activity.suggestion.scope; actorId = activity.actorId;
      resourceId = activity.suggestion.id; eventId = activity.eventId;
      body = "Proposed source changes were updated.";
      break;
    default: assertNever(activity);
  }
  const recipients = z.array(z.object({ id: IdSchema, name: z.string(), primary_email: z.string() })).parse(
    (await context.db.all(`SELECT u.id,u.name,u.primary_email FROM users u JOIN projects p ON p.id=?
      WHERE p.deleted_at IS NULL AND u.suspended=0 AND u.deleted_at IS NULL AND
      (u.id=p.owner_id OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=u.id))`, [scope.projectId])));
  const project = (await store.projects.getProject(scope.projectId));
  const digestAt = new Date((Math.floor(Date.parse(context.clock.now()) / 600000) + 1) * 600000).toISOString();
  for (const recipient of recipients) {
    if (recipient.id === actorId) continue;
    let kind: "mention" | "reply" | "activity" | "suggestion";
    switch (activity.type) {
      case "comment": {
        const firstName = recipient.name.split(/\s+/)[0];
        const aliases = [recipient.name, recipient.primary_email];
        if (firstName && recipients.filter(user => user.name.split(/\s+/)[0]?.toLowerCase() === firstName.toLowerCase()).length === 1) {
          aliases.push(firstName);
        }
        const mentioned = aliases.some(alias => new RegExp(
          `(^|[\\s(])@${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,.;:!?\\)])`, "iu").test(body));
        if (mentioned) kind = "mention";
        else if (replyAuthors.includes(recipient.id)) kind = "reply";
        else {
          const preferences = (await notificationPreferences(context, recipient.id));
          const enabled = preferences.projectOverrides[scope.projectId]?.["activity"] ?? preferences.events["activity"] ?? false;
          if (!enabled) continue;
          kind = "activity";
        }
        break;
      }
      case "suggestion": kind = "suggestion"; break;
      default: assertNever(activity);
    }
    const input = { userId: recipient.id, kind, resourceId, projectId: scope.projectId,
      dedupeKey: `review:${eventId}:${recipient.id}`, mail: { subject: `Quire ${kind}: ${project.name}`, body, digestAt } };
    if (finalization) await planNotification(store, input, finalization);
    else await enqueueNotification(store.transactionContext, input);
  }
}

/** Serialize notification writes into the same recoverable source finalization. */
async function planNotification(store: ReviewStore, input: NotificationInput, plan: SourceFinalization): Promise<void> {
  const { context } = store;
  if (await context.db.get("SELECT 1 FROM governance_notification_receipts WHERE user_id=? AND dedupe_key=?", [input.userId, input.dedupeKey])) return;
  const append = (sql: string, parameters: (string | number | boolean | null)[]) => plan.statements.push({ sqlite: sql, postgres: sql, parameters, changes: 1 });
  append("INSERT INTO governance_notification_receipts(user_id,dedupe_key,created_at) VALUES(?,?,?)", [input.userId, input.dedupeKey, context.clock.now()]);
  const preferences = await notificationPreferences(context, input.userId);
  if (!((input.projectId ? preferences.projectOverrides[input.projectId]?.[input.kind] : undefined) ?? preferences.events[input.kind] ?? true)) return;
  if (preferences.channels.includes("in-app")) {
    const id = uuid();
    append("INSERT INTO notifications(id,user_id,kind,resource_id,created_at) VALUES(?,?,?,?,?)", [id, input.userId, input.kind, input.resourceId, context.clock.now()]);
    plan.events.push({ topic: "notification.created", aggregateId: input.userId, payload: { resourceId: id, version: 0 } });
  }
  if (preferences.channels.includes("email")) {
    append("INSERT INTO governance_digest_items(id,user_id,kind,project_id,resource_id,subject,body,due_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [uuid(), input.userId, input.kind, input.projectId ?? null, input.resourceId, input.mail.subject, input.mail.body, input.mail.digestAt ?? context.clock.now(), context.clock.now()]);
  }
}
