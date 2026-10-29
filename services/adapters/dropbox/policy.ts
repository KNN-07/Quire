import { assertNever } from "@quire/contracts";
import type { Id, SqlExecutor, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { CoreProjects } from "../../core/base";

export class DropboxPolicies {
  constructor(private readonly context: ModuleContext) {}
  async assertImport(actorId: Id, tx: SqlExecutor = this.context.db): Promise<void> {
    await new CoreProjects({ ...this.context, db: tx }).readUser(actorId);
    const denied = await tx.get(`SELECT 1 FROM dropbox_policies WHERE enabled=0 AND scope_kind='organization'
      AND scope_id IN (SELECT organization_id FROM members WHERE user_id=?)`, [actorId]);
    if (denied) throw new ServiceError("DROPBOX_POLICY_DENIED", 403, "Dropbox disabled by current organization policy");
  }
  async get(input: {
    readonly actorId: Id; readonly scope: { readonly kind: "organization" | "project"; readonly id: Id };
  }): Promise<{ readonly enabled: boolean; readonly effectiveEnabled: boolean; readonly version: number }> {
    return this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.authorize(input, tx);
      const row = await tx.get<{ enabled: number; version: number }>(
        "SELECT enabled,version FROM dropbox_policies WHERE scope_kind=? AND scope_id=?", [input.scope.kind, input.scope.id]);
      const enabled = row?.enabled !== 0;
      let effectiveEnabled = enabled;
      if (input.scope.kind === "project") {
        try { await this.assert(input.actorId, input.scope.id, tx); }
        catch (error) {
          if (!(error instanceof ServiceError) || error.code !== "DROPBOX_POLICY_DENIED") throw error;
          effectiveEnabled = false;
        }
      }
      return { enabled, effectiveEnabled, version: row?.version ?? 0 };
    });
  }
  async assert(actorId: Id, projectId: Id, tx: SqlExecutor = this.context.db): Promise<void> {
    const service = new CoreProjects({ ...this.context, db: tx });
    const project = await service.getProject(projectId);
    await service.authorize(actorId, { projectId, branch: project.defaultBranch }, "write");
    await service.policy(actorId, projectId);
    const denied = await tx.get(`SELECT 1 FROM dropbox_policies WHERE enabled=0 AND
      ((scope_kind='project' AND scope_id=?) OR (scope_kind='organization' AND
      (scope_id=? OR scope_id IN (SELECT organization_id FROM members WHERE user_id=?))))`,
    [projectId, project.workspaceId, actorId]);
    if (denied) throw new ServiceError("DROPBOX_POLICY_DENIED", 403, "Dropbox disabled by current organization or project policy");
  }
  async set(input: {
    readonly actorId: Id; readonly scope: { readonly kind: "organization" | "project"; readonly id: Id };
    readonly enabled: boolean; readonly expectedVersion: number;
  }): Promise<number> {
    const version = await this.context.admission.writer(() => this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const organizationId = await this.authorize(input, tx);
      const row = await tx.get<{ version: number }>("SELECT version FROM dropbox_policies WHERE scope_kind=? AND scope_id=?",
        [input.scope.kind, input.scope.id]);
      if ((row?.version ?? 0) !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Dropbox policy changed");
      const next = input.expectedVersion + 1;
      await tx.run(`INSERT INTO dropbox_policies(scope_kind,scope_id,enabled,version) VALUES(?,?,?,?)
        ON CONFLICT(scope_kind,scope_id) DO UPDATE SET enabled=excluded.enabled,version=excluded.version`,
      [input.scope.kind, input.scope.id, Number(input.enabled), next]);
      await tx.run("INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,?,?)",
        [crypto.randomUUID(), this.context.clock.now(), input.actorId,
          organizationId, "adapter.dropbox.policy", input.scope.id,
          JSON.stringify({ enabled: input.enabled, scope: input.scope.kind, version: next })]);
      await this.context.events.record(tx, { topic: "policy.changed", aggregateId: input.scope.id,
        payload: { resourceId: input.scope.id, version: next } });
      return next;
    }));
    await this.context.events.dispatch();
    return version;
  }
  private async authorize(input: {
    readonly actorId: Id; readonly scope: { readonly kind: "organization" | "project"; readonly id: Id };
  }, tx: Transaction): Promise<Id | null> {
    const service = new CoreProjects({ ...this.context, db: tx });
    await service.readUser(input.actorId);
    switch (input.scope.kind) {
      case "project": {
        const project = await service.getProject(input.scope.id);
        await service.authorize(input.actorId, { projectId: project.id, branch: project.defaultBranch }, "owner");
        return project.workspaceId;
      }
      case "organization":
        if (!await tx.get("SELECT 1 FROM members WHERE organization_id=? AND user_id=? AND role='admin'",
          [input.scope.id, input.actorId])) throw new ServiceError("FORBIDDEN", 403, "Organization administrator required");
        return input.scope.id;
      default: return assertNever(input.scope.kind);
    }
  }
}
