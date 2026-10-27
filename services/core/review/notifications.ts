import { z } from "zod";
import { IdSchema, assertNever } from "@quire/contracts";
import type { Comment, Id, Scope, Suggestion } from "@quire/contracts";
import { enqueueNotification, notificationPreferences } from "../../accounts/governance";
import type { ReviewStore } from "./store";

type ReviewActivity =
  | { readonly type: "comment"; readonly scope: Scope; readonly comment: Comment; readonly threadId: Id; readonly reply: boolean }
  | { readonly type: "suggestion"; readonly suggestion: Suggestion; readonly actorId: Id; readonly eventId: string };
/** Called only inside the producer's metadata transaction, before outbox dispatch. */
export function notifyReview(store: ReviewStore, activity: ReviewActivity): void {
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
      if (activity.reply) replyAuthors = context.db.query<{ author_id: Id }, [string]>(
        "SELECT DISTINCT author_id FROM comments WHERE thread_id=?").all(activity.threadId).map(row => row.author_id);
      break;
    case "suggestion":
      scope = activity.suggestion.scope; actorId = activity.actorId;
      resourceId = activity.suggestion.id; eventId = activity.eventId;
      body = "Proposed source changes were updated.";
      break;
    default: assertNever(activity);
  }
  const recipients = z.array(z.object({ id: IdSchema, name: z.string(), primary_email: z.string() })).parse(
    context.db.query(`SELECT u.id,u.name,u.primary_email FROM users u JOIN projects p ON p.id=?
      WHERE p.deleted_at IS NULL AND u.suspended=0 AND u.deleted_at IS NULL AND
      (u.id=p.owner_id OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=u.id))`)
      .all(scope.projectId));
  const project = store.projects.getProject(scope.projectId);
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
          const preferences = notificationPreferences(context, recipient.id);
          const enabled = preferences.projectOverrides[scope.projectId]?.["activity"] ?? preferences.events["activity"] ?? false;
          if (!enabled) continue;
          kind = "activity";
        }
        break;
      }
      case "suggestion": kind = "suggestion"; break;
      default: assertNever(activity);
    }
    enqueueNotification(context, { userId: recipient.id, kind, resourceId, projectId: scope.projectId,
      dedupeKey: `review:${eventId}:${recipient.id}`, mail: { subject: `Quire ${kind}: ${project.name}`, body, digestAt } });
  }
}
