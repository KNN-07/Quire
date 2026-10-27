import { endpoints, ThreadSchema, CommentSchema, OkSchema, AnchorSchema } from "@quire/contracts";
import type { Anchor, Id, Scope } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import type { ReviewMutations } from "./mutations";
import { compare, fail, uuid, page } from "./store";
import * as Y from "yjs";
import { notifyReview } from "./notifications";

export function checkAnchor(store: ReviewMutations, scope: Scope, anchor: Anchor): void {
  const file = store.projects.getFile(scope, anchor.fileId);
  if (!file.editable || file.version.epoch !== anchor.epoch) fail("ANCHOR_CONFLICT", 409, "Anchor epoch changed");
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(store.projects.loadDocument(scope, file.id).state, "base64"));
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
    const rows = context.db.query<{ id: Id }, [string, string]>("SELECT id FROM threads WHERE project_id=? AND branch=? ORDER BY created_at,id")
      .all(scope.projectId, scope.branch);
    return page(rows.map(row => store.threadDto(row.id, scope.projectId))
      .filter(thread => (!input.query.fileId || thread.anchor?.fileId === input.query.fileId)
        && (!input.query.status || input.query.status === "all" || thread.resolved === (input.query.status === "resolved"))), input.query);
  });
  context.routes.register(endpoints.threadGet, async (input, request) => {
    const thread = store.thread(input.params.t, input.params.p);
    if (thread.branch !== input.query.branch) fail("NOT_FOUND", 404, "Thread not on branch");
    await store.read(request, { projectId: input.params.p, branch: thread.branch });
    store.version(request, thread.version);
    return store.threadDto(thread.id, input.params.p);
  });
  context.routes.register(endpoints.threadCreate, async (input, request) => {
    const scope = store.scope(input.params.p, input.body.scope);
    const actorId = await store.write(request, scope, "thread.create");
    return store.mutate({ actorId, request, scope, route: "threadCreate", body: input, schema: ThreadSchema, work: () => {
      compare(store.projects.getBranch(scope).revision, input.body.expectedVersion);
      if (input.body.anchor) checkAnchor(store, scope, input.body.anchor);
      const id = uuid();
      context.db.query("INSERT INTO threads(id,project_id,branch,anchor_json,created_at) VALUES(?,?,?,?,?)")
        .run(id, scope.projectId, scope.branch, input.body.anchor ? JSON.stringify(input.body.anchor) : null, context.clock.now());
      const comment = CommentSchema.parse({ id: uuid(), authorId: actorId, body: input.body.body,
        createdAt: context.clock.now(), editedAt: null, version: 0 });
      context.db.query("INSERT INTO comments(id,thread_id,author_id,body,created_at) VALUES(?,?,?,?,?)")
        .run(comment.id, id, actorId, comment.body, comment.createdAt);
      notifyReview(store, { type: "comment", scope, comment, threadId: id, reply: false });
      store.version(request, 0);
      return store.threadDto(id, scope.projectId);
    } });
  });
  context.routes.register(endpoints.threadPatch, async (input, request) => {
    const scope = store.scope(input.params.p, input.body.scope);
    const actorId = await store.write(request, scope, "write");
    return store.mutate({ actorId, request, scope, route: "threadPatch", body: input, schema: ThreadSchema, work: () => {
      const thread = store.thread(input.params.t, scope.projectId);
      if (thread.branch !== scope.branch) fail("NOT_FOUND", 404, "Thread not on branch");
      compare(thread.version, input.body.expectedVersion);
      if (input.body.anchor) checkAnchor(store, scope, input.body.anchor);
      context.db.query("UPDATE threads SET anchor_json=?,version=version+1 WHERE id=?")
        .run(input.body.anchor ? JSON.stringify(AnchorSchema.parse(input.body.anchor)) : thread.anchor_json, thread.id);
      store.version(request, thread.version + 1);
      return store.threadDto(thread.id, scope.projectId);
    } });
  });
  context.routes.register(endpoints.threadReply, async (input, request) => {
    const thread = store.thread(input.params.t, input.params.p);
    const scope = { projectId: input.params.p, branch: thread.branch };
    const actorId = await store.write(request, scope, "comment");
    return store.mutate({ actorId, request, scope, route: "threadReply", body: input, schema: CommentSchema, work: () => {
      compare(store.thread(thread.id, scope.projectId).version, input.body.expectedVersion);
      const comment = { id: uuid(), authorId: actorId, body: input.body.body, createdAt: context.clock.now(), editedAt: null, version: 0 };
      context.db.query("INSERT INTO comments(id,thread_id,author_id,body,created_at) VALUES(?,?,?,?,?)")
        .run(comment.id, thread.id, actorId, comment.body, comment.createdAt);
      context.db.query("UPDATE threads SET version=version+1 WHERE id=?").run(thread.id);
      notifyReview(store, { type: "comment", scope, comment, threadId: thread.id, reply: true });
      store.version(request, 0);
      return comment;
    } });
  });
  context.routes.register(endpoints.threadState, async (input, request) => {
    const thread = store.thread(input.params.t, input.params.p);
    const scope = { projectId: input.params.p, branch: thread.branch };
    const actorId = await store.write(request, scope, "write");
    return store.mutate({ actorId, request, scope, route: "threadState", body: input, schema: ThreadSchema, work: () => {
      const current = store.thread(thread.id, scope.projectId);
      compare(current.version, input.body.expectedVersion);
      context.db.query("UPDATE threads SET resolved=?,version=version+1 WHERE id=?").run(Number(input.body.resolved), thread.id);
      store.version(request, current.version + 1);
      return store.threadDto(thread.id, scope.projectId);
    } });
  });
  context.routes.register(endpoints.threadDelete, async (input, request) => {
    const scope = store.scope(input.params.p, input.body.scope);
    const actorId = await store.write(request, scope, "write");
    return store.mutate({ actorId, request, scope, route: "threadDelete", body: input, schema: OkSchema, work: () => {
      const thread = store.thread(input.params.t, scope.projectId);
      compare(thread.version, input.body.expectedVersion);
      if (thread.branch !== scope.branch || !thread.resolved) fail("THREAD_OPEN", 409, "Resolve the thread before deleting");
      context.db.query(`INSERT INTO permanent_comment_tombstones(comment_id,project_id,deleted_by,deleted_at)
        SELECT id,?,?,? FROM comments WHERE thread_id=?`).run(scope.projectId, actorId, context.clock.now(), thread.id);
      context.db.query("DELETE FROM threads WHERE id=?").run(thread.id);
      return { ok: true, version: thread.version + 1 };
    } });
  });
}
