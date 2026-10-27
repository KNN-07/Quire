import { z } from "zod";
import type { Id, Scope, Role, Policy } from "@quire/contracts";
import { BaseStore, fail } from "./store";
import { requireEditorOpen } from "../../accounts/governance";

const readActions = new Set(["read", "view", "download", "copy", "snapshot", "git.read", "history.read"]);
const editorActions = new Set([
  "write", "edit", "compile", "files.write", "source.write", "document.update", "suggestion.accept",
  "suggestion.decide", "history.restore", "git.write", "git.push", "git.commit", "git.stage",
  "git.branch", "git.merge", "git.discard", "settings", "link.create", "link.refresh",
]);
const reviewActions = new Set(["review", "comment", "suggest", "suggestion.create", "thread.create", "chat"]);
export class AccessStore extends BaseStore {
  role(actorId: Id, projectId: Id): Role {
    this.readUser(actorId);
    const project = this.getProject(projectId);
    if (project.ownerId === actorId) return "owner";
    const row = this.context.db.query<{ role: string }, [string, string]>(
      "SELECT role FROM project_members WHERE project_id=? AND user_id=?").get(projectId, actorId);
    if (!row) fail("NOT_FOUND", 404, "Project not found");
    return z.enum(["editor", "reviewer", "viewer"]).parse(row.role);
  }
  async authorize(actorId: Id, scope: Scope, action: string): Promise<void> {
    const role = this.role(actorId, scope.projectId);
    this.getBranch(scope);
    if (readActions.has(action)) return;
    requireEditorOpen(this.context);
    if (editorActions.has(action) && (role === "owner" || role === "editor")) return;
    if (reviewActions.has(action) && role !== "viewer") return;
    if (action === "chat" && role === "viewer") return;
    if (["owner", "share", "transfer", "delete", "access.manage"].includes(action) && role === "owner") return;
    fail("FORBIDDEN", 403, `Role ${role} cannot ${action}`);
  }
  async policy(actorId: Id, projectId: Id): Promise<Policy> {
    return this.context.services.get("policy").forProject(actorId, projectId);
  }
  async checkSharing(actorId: Id, projectId: Id, targetId?: Id): Promise<void> {
    const policy = await this.policy(actorId, projectId);
    if (policy.sharing === "organization") {
      const project = this.getProject(projectId);
      if (!targetId || !project.workspaceId || !this.context.db.query(
        "SELECT 1 FROM members WHERE organization_id=? AND user_id=?").get(project.workspaceId, targetId)) {
        fail("SHARING_POLICY", 403, "Sharing is restricted to organization members");
      }
    }
  }
  async checkCapacity(actorId: Id, projectId: Id, role: string): Promise<void> {
    if (role !== "editor") return;
    const policy = await this.policy(actorId, projectId);
    const count = this.one(`SELECT count(*) AS n FROM project_members WHERE project_id=? AND role='editor'`,
      [projectId], z.object({ n: z.number() })).n;
    if (policy.writableMembers !== null && count >= policy.writableMembers) {
      fail("WRITABLE_CAPACITY", 403, "Writable membership capacity reached");
    }
  }
  async authorizeRequest(request: Request, scope: Scope, action: string): Promise<Id | null> {
    const identity = this.context.services.get("identity");
    const principal = await identity.authenticate(request);
    if (principal) {
      try {
        await this.authorize(principal.user.id, scope, action);
        if (!["GET", "HEAD"].includes(request.method)) await identity.verifyMutation(request, principal);
        return principal.user.id;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "NOT_FOUND") throw error;
      }
    }
    const token = request.headers.get("x-project-token") ?? new URL(request.url).searchParams.get("share");
    if (!token) fail(principal ? "NOT_FOUND" : "UNAUTHENTICATED", principal ? 404 : 401, "Project access required");
    const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    const share = this.one(`SELECT id,role FROM share_tokens WHERE project_id=? AND token_hash=? AND revoked_at IS NULL`,
      [scope.projectId, hash], z.object({ id: z.string(), role: z.enum(["viewer", "editor"]) }));
    const project = this.getProject(scope.projectId);
    this.getBranch(scope);
    const policy = await this.policy(project.ownerId, project.id);
    if (policy.sharing !== "anyone") fail("FORBIDDEN", 403, "Link sharing is disabled");
    if (readActions.has(action)) {
      if (!principal && !policy.anonymousRead) fail("UNAUTHENTICATED", 401, "Sign in to use this link");
      return principal?.user.id ?? null;
    }
    if (!principal || share.role !== "editor" || !editorActions.has(action)) fail("FORBIDDEN", 403, "Read-only link");
    await identity.verifyMutation(request, principal);
    requireEditorOpen(this.context);
    await this.checkCapacity(project.ownerId, project.id, "editor");
    this.context.uow.local((tx) => {
      const active = tx.query("SELECT 1 FROM share_tokens WHERE id=? AND revoked_at IS NULL").get(share.id);
      if (!active) fail("FORBIDDEN", 403, "Link was revoked");
      const existing = tx.query("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(project.id, principal.user.id);
      if (existing) return;
      const id = crypto.randomUUID();
      tx.query(`INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)
        ON CONFLICT(project_id,user_id) DO NOTHING`).run(id, project.id, principal.user.id, this.context.clock.now());
      tx.query("INSERT INTO base_link_members(member_id,share_id) VALUES(?,?)").run(id, share.id);
      this.context.events.append(tx, { topic: "access.changed", aggregateId: project.id,
        payload: { resourceId: project.id, version: project.version } });
    });
    this.context.events.dispatch();
    return principal.user.id;
  }
}
