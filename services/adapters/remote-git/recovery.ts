import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import type { AdapterServices } from "../shared";
import type { RemoteGitStore } from "./store";

export async function recoverRemoteGit(
  services: AdapterServices,
  store: RemoteGitStore,
): Promise<void> {
  const projects = new CoreProjects(services.context);
  for (const intent of await store.intents()) {
    const { payload } = intent;
    const scope = payload.source.snapshot.scope;
    const lease = await services.context.branches.acquire(scope, crypto.randomUUID(), 60_000);
    if (!lease) {
      throw new ServiceError("BRANCH_BUSY", 409, "Remote Git recovery branch is busy");
    }
    try {
      await services.grants.credentials(intent.actorId, intent.grantId);
      if (payload.project) {
        await services.grants.activeActor(intent.actorId, services.context.db);
        if (payload.project.workspaceId && !await services.context.db.get(
          "SELECT 1 FROM members WHERE organization_id=? AND user_id=?",
          [payload.project.workspaceId, intent.actorId],
        )) {
          throw new ServiceError("FORBIDDEN", 403, "Workspace membership changed during remote Git recovery");
        }
      } else {
        await projects.authorize(intent.actorId, scope, "git.write");
      }
      await services.context.repositories.recover(intent.id, lease);
      await services.context.uow.run(async (tx) => {
        await tx.lock("quire:accounts");
        if (payload.project && !await tx.get("SELECT id FROM projects WHERE id=?", [payload.project.id])) {
          const project = payload.project;
          await tx.run(`INSERT INTO projects
            (id,name,owner_id,workspace_id,default_branch,settings_json,version,created_at,updated_at)
            VALUES(?,?,?,?,?,?,0,?,?)`, [
            project.id,
            project.name,
            project.ownerId,
            project.workspaceId,
            project.defaultBranch,
            JSON.stringify(project.settings),
            project.createdAt,
            project.updatedAt,
          ]);
          await tx.run(
            "INSERT INTO branch_workspaces(id,project_id,branch,created_at,updated_at) VALUES(?,?,?,?,?)",
            [payload.source.branchId, project.id, project.defaultBranch, project.createdAt, project.updatedAt],
          );
          await tx.run(
            "INSERT INTO repositories(project_id,relative_path,created_at) VALUES(?,?,?)",
            [project.id, `git/${project.id}.git`, project.createdAt],
          );
        }
        const events = await projects.finalizePreparedSources(tx, {
          publication: { id: intent.id, lease },
          sources: [{ source: payload.source, lease }],
        });
        await store.finalizeDomain(tx, {
          intentId: intent.id,
          payload,
          events: [
            ...events,
            {
              topic: "git.changed",
              aggregateId: intent.projectId,
              payload: {
                resourceId: intent.projectId,
                version: payload.source.snapshot.revision,
              },
            },
          ],
        });
        await store.recoverReceipt(tx, payload);
      });
      await services.context.events.dispatch();
    } finally {
      await services.context.branches.release(lease);
    }
  }
}
