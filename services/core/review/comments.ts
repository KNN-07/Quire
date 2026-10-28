import { z } from "zod";
import { endpoints, CommentSchema, IdSchema, InstantSchema, OkSchema } from "@quire/contracts";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import type { Id } from "@quire/contracts";
import type { ReviewMutations } from "./mutations";
import { compare, fail, uuid, page } from "./store";
import { notifyReview } from "./notifications";

export function registerComments(context: ModuleContext, store: ReviewMutations): void {
  async function locate(projectId: Id, id: Id, request: RequestContext) {
    const row = commentRow.parse((await context.db.get(`SELECT c.*,t.project_id,t.branch FROM comments c
      JOIN threads t ON c.thread_id=t.id WHERE c.id=? AND t.project_id=?`, [id, projectId]))
      ?? fail("NOT_FOUND", 404, "Comment not found"));
    const scope = { projectId, branch: row.branch };
    const actorId = await store.write(request, scope, "comment");
    if (actorId !== row.author_id) fail("FORBIDDEN", 403, "Only the author may change a comment");
    return { row, scope, actorId };
  }
  context.routes.register(endpoints.commentPatch, async (input, request) => {
    const { row, scope, actorId } = await locate(input.params.p, input.params.id, request);
    return store.mutate({ actorId, request, scope, route: "commentPatch", body: input, schema: CommentSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      const current = z.object({ version: z.number() }).parse((await boundContext.db.get("SELECT version FROM comments WHERE id=?", [row.id]))
        ?? fail("NOT_FOUND", 404, "Comment deleted"));
      compare(current.version, input.body.expectedVersion);
      const now = boundContext.clock.now();
      (await boundContext.db.run("UPDATE comments SET body=?,edited_at=?,version=version+1 WHERE id=?", [input.body.body, now, row.id]));
      boundStore.version(request, current.version + 1);
      const comment = { id: row.id, authorId: row.author_id, body: input.body.body, createdAt: row.created_at, editedAt: now, version: current.version + 1 };
      (await notifyReview(boundStore, { type: "comment", scope, comment, threadId: row.thread_id, reply: false }));
      return comment;
    } });
  });
  context.routes.register(endpoints.commentDelete, async (input, request) => {
    const { row, scope, actorId } = await locate(input.params.p, input.params.id, request);
    return store.mutate({ actorId, request, scope, route: "commentDelete", body: input, schema: OkSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      const current = z.object({ version: z.number() }).parse((await boundContext.db.get("SELECT version FROM comments WHERE id=?", [row.id]))
        ?? fail("NOT_FOUND", 404, "Comment deleted"));
      compare(current.version, input.body.expectedVersion);
      (await boundContext.db.run("INSERT INTO permanent_comment_tombstones(comment_id,project_id,deleted_by,deleted_at) VALUES(?,?,?,?)", [row.id, scope.projectId, actorId, boundContext.clock.now()]));
      (await boundContext.db.run("DELETE FROM comments WHERE id=?", [row.id]));
      return { ok: true, version: current.version + 1 };
    } });
  });
  context.routes.register(endpoints.chatList, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    const actorId = await store.actor(request);
    await store.read(request, scope);
    (await store.projects.role(actorId, scope.projectId));
    if (!(await store.projects.policy(actorId, scope.projectId)).chat) fail("CHAT_DISABLED", 403, "Chat is disabled by policy");
    return page((await context.db.all(`SELECT id,author_id AS "authorId",body,created_at AS "createdAt",edited_at AS "editedAt",version
      FROM chat_messages WHERE project_id=? AND branch=? ORDER BY created_at,id`, [scope.projectId, scope.branch]))
      .map(row => CommentSchema.parse(row)), input.query);
  });
  context.routes.register(endpoints.chatCreate, async (input, request) => {
    const scope = (await store.scope(input.params.p, input.body.scope));
    const actorId = await store.write(request, scope, "chat");
    if (!(await store.projects.policy(actorId, scope.projectId)).chat) fail("CHAT_DISABLED", 403, "Chat is disabled by policy");
    return store.mutate({ actorId, request, scope, route: "chatCreate", body: input, schema: CommentSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      compare((await boundStore.projects.getBranch(scope)).revision, input.body.expectedVersion);
      const comment = { id: uuid(), authorId: actorId, body: input.body.body, createdAt: boundContext.clock.now(), editedAt: null, version: 0 };
      (await boundContext.db.run("INSERT INTO chat_messages(id,project_id,branch,author_id,body,created_at) VALUES(?,?,?,?,?,?)", [comment.id, scope.projectId, scope.branch, actorId, comment.body, comment.createdAt]));
      return comment;
    } });
  });
}
const commentRow = z.object({ id: IdSchema, thread_id: IdSchema, author_id: IdSchema, project_id: IdSchema,
  branch: z.string(), body: z.string(), created_at: InstantSchema, edited_at: InstantSchema.nullable(), version: z.number() });
