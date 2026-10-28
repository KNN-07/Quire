import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, Scope, Role, Policy } from "@quire/contracts";
import { BaseStore, fail } from "./store";
import { requireEditorOpen } from "../../accounts/governance";
import { policy as policyPort } from "../../accounts/identity/policy";
import { effectiveProjectRole, writableAdmission, selectAdmittedMember } from "../../accounts/identity/project-benefits";

const readActions = new Set(["read", "view", "download", "copy", "snapshot", "git.read", "history.read"]);
const editorActions = new Set([
  "write", "edit", "compile", "files.write", "source.write", "document.update", "suggestion.accept",
  "suggestion.decide", "history.restore", "git.write", "git.push", "git.commit", "git.stage",
  "git.branch", "git.merge", "git.discard", "settings", "link.create", "link.refresh",
]);
const reviewActions = new Set(["review", "comment", "suggest", "suggestion.create", "thread.create", "chat"]);
export class AccessStore extends BaseStore {
  async role(actorId: Id, projectId: Id): Promise<Role> {
    (await this.readUser(actorId));
    const project = (await this.getProject(projectId));
    if (project.ownerId === actorId) return "owner";
    const row = (await this.context.db.get<{ role: string }>("SELECT role FROM project_members WHERE project_id=? AND user_id=?", [projectId, actorId]));
    if (!row) fail("NOT_FOUND", 404, "Project not found");
    const link = await this.context.db.get<{ revoked_at: string | null }>(
      `SELECT s.revoked_at FROM base_link_members l JOIN project_members m ON m.id=l.member_id
       JOIN share_tokens s ON s.id=l.share_id WHERE m.project_id=? AND m.user_id=?`, [projectId, actorId]);
    if (link && (link.revoked_at !== null || (await this.policy(actorId, projectId)).sharing !== "anyone")) {
      fail("FORBIDDEN", 403, "Link access is no longer permitted");
    }
    return z.enum(["editor", "reviewer", "viewer"]).parse(row.role);
  }
  async authorize(actorId: Id, scope: Scope, action: string): Promise<void> {
    const role = (await this.effectiveRole(actorId, scope.projectId));
    (await this.getBranch(scope));
    if (readActions.has(action)) return;
    (await requireEditorOpen(this.context));
    if (editorActions.has(action) && (role === "owner" || role === "editor")) return;
    if (reviewActions.has(action) && role !== "viewer") return;
    if (action === "chat" && role === "viewer") return;
    if (["owner", "share", "transfer", "delete", "access.manage"].includes(action) && role === "owner") return;
    fail("FORBIDDEN", 403, `Role ${role} cannot ${action}`);
  }
  async policy(actorId: Id, projectId: Id): Promise<Policy> {
    return policyPort(this.context).forProject(actorId, projectId);
  }
  async effectiveRole(actorId: Id, projectId: Id, role?: Role): Promise<Role> {
    const assigned = role ?? await this.role(actorId, projectId);
    const policy = await this.policy(actorId, projectId);
    return effectiveProjectRole(this.context, { projectId, actorId, role: assigned, actorCapacity: policy.writableMembers });
  }
  async checkSharing(actorId: Id, projectId: Id, targetId?: Id): Promise<void> {
    const policy = await this.policy(actorId, projectId);
    if (policy.sharing === "organization") {
      const project = (await this.getProject(projectId));
      if (!targetId || !project.workspaceId || !(await this.context.db.get("SELECT 1 FROM members WHERE organization_id=? AND user_id=?", [project.workspaceId, targetId]))) {
        fail("SHARING_POLICY", 403, "Sharing is restricted to organization members");
      }
    }
  }
  async checkCapacity(actorId: Id, projectId: Id, input: {
    readonly role: string; readonly userId?: Id;
  }): Promise<void> {
    if (input.role !== "editor" && input.role !== "reviewer") return;
    const policy = await this.policy(actorId, projectId);
    if (!await writableAdmission(this.context, { projectId, actorCapacity: policy.writableMembers,
      ...(input.userId ? { userId: input.userId } : {}) })) {
      fail("WRITABLE_CAPACITY", 403, "Writable membership capacity reached");
    }
  }
  private async linkAccess(request: Request, scope: Scope, actorId: Id | null) {
    const token = request.headers.get("x-project-token") ?? new URL(request.url).searchParams.get("share");
    if (!token) fail(actorId ? "NOT_FOUND" : "UNAUTHENTICATED", actorId ? 404 : 401, "Project access required");
    const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    const share = await this.one("SELECT id,role FROM share_tokens WHERE project_id=? AND token_hash=? AND revoked_at IS NULL",
      [scope.projectId, hash], z.object({ id: z.string(), role: z.enum(["viewer", "editor"]) }));
    const project = await this.getProject(scope.projectId);
    await this.getBranch(scope);
    const policy = await this.policy(project.ownerId, project.id);
    if (policy.sharing !== "anyone") fail("FORBIDDEN", 403, "Link sharing is disabled");
    return { share, project, policy };
  }
  /** Rechecks a previously authenticated read credential on this store's SQL context. */
  async authorizeRead(request: Request, scope: Scope, actorId: Id | null): Promise<void> {
    if (actorId) {
      await this.readUser(actorId);
      try { await this.authorize(actorId, scope, "read"); return; }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "NOT_FOUND") throw error;
      }
    }
    const { policy } = await this.linkAccess(request, scope, actorId);
    if (actorId === null && !policy.anonymousRead) fail("UNAUTHENTICATED", 401, "Sign in to use this link");
  }
  async authorizeRequest(request: Request, scope: Scope, action: string): Promise<Id | null> {
    const identity = this.context.services.get("identity");
    const principal = await identity.authenticate(request);
    if (readActions.has(action)) {
      await this.authorizeRead(request, scope, principal?.user.id ?? null);
      if (principal && !["GET", "HEAD"].includes(request.method)) await identity.verifyMutation(request, principal);
      return principal?.user.id ?? null;
    }
    if (principal) {
      try {
        await this.authorize(principal.user.id, scope, action);
        if (!["GET", "HEAD"].includes(request.method)) await identity.verifyMutation(request, principal);
        return principal.user.id;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "NOT_FOUND") throw error;
      }
    }
    const { share, project } = await this.linkAccess(request, scope, principal?.user.id ?? null);
    if (!principal || share.role !== "editor" || !editorActions.has(action)) fail("FORBIDDEN", 403, "Read-only link");
    await identity.verifyMutation(request, principal);
    (await requireEditorOpen(this.context));
    await this.checkCapacity(project.ownerId, project.id, { role: "editor", userId: principal.user.id });
    (await this.context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const boundContext = { ...this.context, db: tx };
      const boundService = new AccessStore(boundContext);

      const active = (await tx.get("SELECT 1 FROM share_tokens WHERE id=? AND revoked_at IS NULL", [share.id]));
      if (!active) fail("FORBIDDEN", 403, "Link was revoked");
      const existing = (await tx.get("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", [project.id, principal.user.id]));
      if (existing) return;
      await boundService.readUser(principal.user.id);
      await requireEditorOpen(boundContext);
      const current = await boundService.getProject(project.id);
      if (current.ownerId === principal.user.id) return;
      const currentPolicy = await boundService.policy(current.ownerId, project.id);
      if (currentPolicy.sharing !== "anyone") fail("FORBIDDEN", 403, "Link sharing is disabled");
      await boundService.checkCapacity(current.ownerId, project.id, { role: "editor", userId: principal.user.id });
      const id = IdSchema.parse(crypto.randomUUID());
      (await tx.run(`INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)
        ON CONFLICT(project_id,user_id) DO NOTHING`, [id, project.id, principal.user.id, boundContext.clock.now()]));
      (await tx.run("INSERT INTO base_link_members(member_id,share_id) VALUES(?,?)", [id, share.id]));
      await selectAdmittedMember(boundContext, { projectId: project.id, memberId: id });
      await boundContext.events.record(tx, {
        topic: "access.changed", aggregateId: project.id,
        payload: { resourceId: project.id, version: project.version }
      });

    }));
    (await this.context.events.dispatch());
    return principal.user.id;
  }
}
