import { z } from "zod";
import { IdSchema, CommentSchema, ThreadSchema, SuggestionSchema } from "@quire/contracts";
import type { Id, Scope, Page } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, RequestContext, Transaction, SqlExecutor } from "@quire/runtime";
import { CoreProjects } from "../base";

export const uuid = (): Id => IdSchema.parse(crypto.randomUUID());
export function fail(code: string, status: number, message: string): never {
  throw new ServiceError(code, status, message);
}
export function compare(actual: number, expected: number): void {
  if (actual !== expected) fail("STALE_VERSION", 409, `Expected ${expected}, current ${actual}`);
}
export class ReviewStore {
  readonly projects: CoreProjects;
  constructor(readonly context: ModuleContext, projects?: CoreProjects) {
    const port = context.services.get("projects");
    if (!(port instanceof CoreProjects)) fail("CORE_BASE_REQUIRED", 503, "Native source writer is required");
    this.projects = projects ?? port;
  }
  withTransaction(tx: Transaction): ReviewStore {
    return new ReviewStore({ ...this.context, db: tx }, this.projects.withTransaction(tx));
  }
  get transaction(): Transaction {
    if (!isTransaction(this.context.db)) fail("TRANSACTION_REQUIRED", 500, "Review write requires a transaction");
    return this.context.db;
  }
  get transactionContext() { return { ...this.context, db: this.transaction }; }
  async assertSession(request: Request, actorId: Id, scope: Scope): Promise<void> {
    const tokens = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim())
      .filter(part => part.startsWith("quire_session="));
    const token = tokens.length === 1 ? tokens[0]?.slice("quire_session=".length) : null;
    if (!token || !await this.context.db.get(
      "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.suspended=0 AND u.deleted_at IS NULL",
      [new Bun.CryptoHasher("sha256").update(token).digest("hex"), actorId, this.context.clock.now()])) {
      fail("UNAUTHENTICATED", 401, "Session revoked");
    }
    if (await this.context.db.get(
      "SELECT 1 FROM base_link_members l JOIN project_members m ON m.id=l.member_id WHERE m.project_id=? AND m.user_id=?",
      [scope.projectId, actorId])) {
      if (!await this.context.db.get(
        "SELECT 1 FROM base_link_members l JOIN project_members m ON m.id=l.member_id JOIN share_tokens s ON s.id=l.share_id WHERE m.project_id=? AND m.user_id=? AND s.revoked_at IS NULL",
        [scope.projectId, actorId]) || (await this.projects.policy(actorId, scope.projectId)).sharing !== "anyone") fail("FORBIDDEN", 403, "Link access revoked");
    }
  }
  async actor(request: RequestContext): Promise<Id> {
    const identity = this.context.services.get("identity");
    const principal = await identity.require(request.request);
    if (!["GET", "HEAD"].includes(request.request.method)) await identity.verifyMutation(request.request, principal);
    return principal.user.id;
  }
  async scope(projectId: Id, scope: Scope): Promise<Scope> {
    if (scope.projectId !== projectId) fail("SCOPE_MISMATCH", 400, "Project path and scope differ");
    (await this.projects.getBranch(scope));
    return scope;
  }
  async thread(id: Id, projectId: Id) {
    const row = (await this.context.db.get("SELECT * FROM threads WHERE id=? AND project_id=?", [id, projectId]));
    if (!row) fail("NOT_FOUND", 404, "Thread not found");
    return threadRow.parse(row);
  }
  async threadDto(id: Id, projectId: Id) {
    const row = (await this.thread(id, projectId));
    return ThreadSchema.parse({ id, scope: { projectId, branch: row.branch },
      anchor: row.anchor_json ? JSON.parse(row.anchor_json) : null, resolved: Boolean(row.resolved),
      comments: (await this.context.db.all(`SELECT id,author_id AS "authorId",body,created_at AS "createdAt",
        edited_at AS "editedAt",version FROM comments WHERE thread_id=? ORDER BY created_at,id`, [id])).map(value => CommentSchema.parse(value)) });
  }
  async suggestion(id: Id, projectId: Id) {
    const row = suggestionRow.parse((await this.context.db.get("SELECT * FROM suggestions WHERE id=? AND project_id=?", [id, projectId]))
      ?? fail("NOT_FOUND", 404, "Suggestion not found"));
    const edits = (await this.context.db.all(`SELECT id,file_id AS "fileId",anchor_json,before_text AS "before",
      after_text AS "after",base_revision AS "baseRevision",status FROM suggestion_edits WHERE suggestion_id=? ORDER BY edit_order`, [id]))
      .map(value => {
        const edit = editRow.parse(value);
        const { anchor_json, ...rest } = edit;
        return { ...rest, anchor: JSON.parse(anchor_json) };
      });
    return { version: row.version, dto: SuggestionSchema.parse({ id, scope: { projectId, branch: row.branch },
      authorId: row.author_id, origin: row.origin, createdAt: row.created_at, edits }) };
  }
  async changed(scope: Scope): Promise<void> {
    await this.context.events.record(this.transaction, { topic: "review.changed", aggregateId: scope.projectId,
      payload: { resourceId: scope.projectId, version: (await this.projects.getBranch(scope)).revision } });
  }
  async read(request: RequestContext, scope: Scope): Promise<Id | null> {
    return this.authorizeRead(request.request, scope);
  }
  async authorizeRead(request: Request, scope: Scope): Promise<Id | null> {
    const actorId = await this.projects.authorizeRequest(request, scope, "read");
    if (actorId && (await this.context.db.get(`SELECT 1 FROM base_link_members l JOIN project_members m ON m.id=l.member_id
      WHERE m.project_id=? AND m.user_id=?`, [scope.projectId, actorId]))) {
      const live = (await this.context.db.get(`SELECT 1 FROM base_link_members l JOIN project_members m ON m.id=l.member_id
        JOIN share_tokens s ON s.id=l.share_id WHERE m.project_id=? AND m.user_id=? AND s.revoked_at IS NULL`, [scope.projectId, actorId]));
      if (!live || (await this.projects.policy(actorId, scope.projectId)).sharing !== "anyone") {
        fail("FORBIDDEN", 403, "Link access is no longer permitted");
      }
    }
    return actorId;
  }
  async write(request: RequestContext, scope: Scope, action: string): Promise<Id> {
    const actor = await this.actor(request);
    await this.authorizeRead(request.request, scope);
    await this.projects.authorize(actor, scope, action);
    return actor;
  }
}
export const threadRow = z.object({ id: IdSchema, project_id: IdSchema, branch: z.string(),
  anchor_json: z.string().nullable(), resolved: z.number(), version: z.number(), created_at: z.string() });
const suggestionRow = z.object({ id: IdSchema, project_id: IdSchema, branch: z.string(), author_id: IdSchema,
  origin: z.enum(["human", "ai"]), version: z.number(), created_at: z.string() });
const editRow = z.object({ id: IdSchema, fileId: IdSchema, anchor_json: z.string(), before: z.string(),
  after: z.string(), baseRevision: z.number(), status: z.string() });
export function page<T extends { readonly id: Id }>(items: readonly T[], query: {
  readonly cursor?: string | undefined; readonly limit: number;
}): Page<T> {
  const index = query.cursor ? items.findIndex(item => item.id === query.cursor) : -1;
  if (query.cursor && index < 0) fail("INVALID_CURSOR", 400, "Cursor is not in this result set");
  const selected = items.slice(index + 1, index + 1 + query.limit);
  return { items: selected, nextCursor: index + 1 + selected.length < items.length ? selected.at(-1)?.id ?? null : null };
}

function isTransaction(db: SqlExecutor): db is Transaction {
  return "transaction" in db && db.transaction === true && "lock" in db && typeof db.lock === "function";
}
