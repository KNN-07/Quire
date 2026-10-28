import { endpoints, ThreadSchema, CommentSchema, OkSchema, AnchorSchema } from "@quire/contracts";
import type { Anchor, Id, Scope } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import type { ReviewMutations } from "./mutations";
import { compare, fail, uuid, page } from "./store";
import * as Y from "yjs";
import { notifyReview } from "./notifications";

export async function checkAnchor(store: ReviewMutations, scope: Scope, anchor: Anchor): Promise<void> {
  const file = (await store.projects.getFile(scope, anchor.fileId));
  if (!file.editable || file.version.epoch !== anchor.epoch) fail("ANCHOR_CONFLICT", 409, "Anchor epoch changed");
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from((await store.projects.loadDocument(scope, file.id)).state, "base64"));
    const text = doc.getText("source");
    const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(anchor.startRelative, "base64")), doc);
    const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(anchor.endRelative, "base64")), doc);
    if (!start || !end || start.type !== text || end.type !== text || start.index > end.index
      || text.toJSON().slice(start.index, end.index) !== anchor.quote) fail("ANCHOR_CONFLICT", 409, "Anchor no longer selects the exact quote");
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error) fail("ANCHOR_CONFLICT", 409, "Invalid relative position");
    throw error;
  } finally { doc.destroy(); }
}
export function registerThreads(context: ModuleContext, store: ReviewMutations): void {
  context.routes.register(endpoints.threadsList, async (input, request) => {
    const scope = { projectId: input.params.p, branch: input.query.branch };
    await store.read(request, scope);
    const rows = (await context.db.all<{ id: Id }>("SELECT id FROM threads WHERE project_id=? AND branch=? ORDER BY created_at,id", [scope.projectId, scope.branch]));
    return page((await Promise.all(rows.map(async row => (await store.threadDto(row.id, scope.projectId)))))
      .filter(thread => (!input.query.fileId || thread.anchor?.fileId === input.query.fileId)
        && (!input.query.status || input.query.status === "all" || thread.resolved === (input.query.status === "resolved"))), input.query);
  });
  context.routes.register(endpoints.threadGet, async (input, request) => {
    const thread = (await store.thread(input.params.t, input.params.p));
    if (thread.branch !== input.query.branch) fail("NOT_FOUND", 404, "Thread not on branch");
    await store.read(request, { projectId: input.params.p, branch: thread.branch });
    store.version(request, thread.version);
    return (await store.threadDto(thread.id, input.params.p));
  });
  context.routes.register(endpoints.threadCreate, async (input, request) => {
    const scope = (await store.scope(input.params.p, input.body.scope));
    const actorId = await store.write(request, scope, "thread.create");
    return store.mutate({ actorId, request, scope, route: "threadCreate", body: input, schema: ThreadSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      compare((await boundStore.projects.getBranch(scope)).revision, input.body.expectedVersion);
      if (input.body.anchor) (await checkAnchor(boundStore, scope, input.body.anchor));
      const id = uuid();
      (await boundContext.db.run("INSERT INTO threads(id,project_id,branch,anchor_json,created_at) VALUES(?,?,?,?,?)", [id, scope.projectId, scope.branch, input.body.anchor ? JSON.stringify(input.body.anchor) : null, boundContext.clock.now()]));
      const comment = CommentSchema.parse({ id: uuid(), authorId: actorId, body: input.body.body,
        createdAt: boundContext.clock.now(), editedAt: null, version: 0 });
      (await boundContext.db.run("INSERT INTO comments(id,thread_id,author_id,body,created_at) VALUES(?,?,?,?,?)", [comment.id, id, actorId, comment.body, comment.createdAt]));
      (await notifyReview(boundStore, { type: "comment", scope, comment, threadId: id, reply: false }));
      boundStore.version(request, 0);
      return (await boundStore.threadDto(id, scope.projectId));
    } });
  });
  context.routes.register(endpoints.threadPatch, async (input, request) => {
    const scope = (await store.scope(input.params.p, input.body.scope));
    const actorId = await store.write(request, scope, "write");
    return store.mutate({ actorId, request, scope, route: "threadPatch", body: input, schema: ThreadSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      const thread = (await boundStore.thread(input.params.t, scope.projectId));
      if (thread.branch !== scope.branch) fail("NOT_FOUND", 404, "Thread not on branch");
      compare(thread.version, input.body.expectedVersion);
      if (input.body.anchor) (await checkAnchor(boundStore, scope, input.body.anchor));
      (await boundContext.db.run("UPDATE threads SET anchor_json=?,version=version+1 WHERE id=?", [input.body.anchor ? JSON.stringify(AnchorSchema.parse(input.body.anchor)) : thread.anchor_json, thread.id]));
      boundStore.version(request, thread.version + 1);
      return (await boundStore.threadDto(thread.id, scope.projectId));
    } });
  });
  context.routes.register(endpoints.threadReply, async (input, request) => {
    const thread = (await store.thread(input.params.t, input.params.p));
    const scope = { projectId: input.params.p, branch: thread.branch };
    const actorId = await store.write(request, scope, "comment");
    return store.mutate({ actorId, request, scope, route: "threadReply", body: input, schema: CommentSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      compare((await boundStore.thread(thread.id, scope.projectId)).version, input.body.expectedVersion);
      const comment = { id: uuid(), authorId: actorId, body: input.body.body, createdAt: boundContext.clock.now(), editedAt: null, version: 0 };
      (await boundContext.db.run("INSERT INTO comments(id,thread_id,author_id,body,created_at) VALUES(?,?,?,?,?)", [comment.id, thread.id, actorId, comment.body, comment.createdAt]));
      (await boundContext.db.run("UPDATE threads SET version=version+1 WHERE id=?", [thread.id]));
      (await notifyReview(boundStore, { type: "comment", scope, comment, threadId: thread.id, reply: true }));
      boundStore.version(request, 0);
      return comment;
    } });
  });
  context.routes.register(endpoints.threadState, async (input, request) => {
    const thread = (await store.thread(input.params.t, input.params.p));
    const scope = { projectId: input.params.p, branch: thread.branch };
    const actorId = await store.write(request, scope, "write");
    return store.mutate({ actorId, request, scope, route: "threadState", body: input, schema: ThreadSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      const current = (await boundStore.thread(thread.id, scope.projectId));
      compare(current.version, input.body.expectedVersion);
      (await boundContext.db.run("UPDATE threads SET resolved=?,version=version+1 WHERE id=?", [Number(input.body.resolved), thread.id]));
      boundStore.version(request, current.version + 1);
      return (await boundStore.threadDto(thread.id, scope.projectId));
    } });
  });
  context.routes.register(endpoints.threadDelete, async (input, request) => {
    const scope = (await store.scope(input.params.p, input.body.scope));
    const actorId = await store.write(request, scope, "write");
    return store.mutate({ actorId, request, scope, route: "threadDelete", body: input, schema: OkSchema, work: async boundStore => {
      const boundContext = boundStore.context;
      const thread = (await boundStore.thread(input.params.t, scope.projectId));
      compare(thread.version, input.body.expectedVersion);
      if (thread.branch !== scope.branch || !thread.resolved) fail("THREAD_OPEN", 409, "Resolve the thread before deleting");
      (await boundContext.db.run(`INSERT INTO permanent_comment_tombstones(comment_id,project_id,deleted_by,deleted_at)
        SELECT id,?,?,? FROM comments WHERE thread_id=?`, [scope.projectId, actorId, boundContext.clock.now(), thread.id]));
      (await boundContext.db.run("DELETE FROM threads WHERE id=?", [thread.id]));
      return { ok: true, version: thread.version + 1 };
    } });
  });
}
