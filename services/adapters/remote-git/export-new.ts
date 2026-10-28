import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import { recoverBranch } from "../../core/base/source-recovery";
import { GitRepository } from "../../core/git";
import type { AdapterServices, ActionContext, PreparedAction } from "../shared";
import { RemoteRepository } from "./git-process";
import type { GitCredentials, RemoteGitOptions } from "./git-process";
import type { RemoteGitStore } from "./store";
import type { RemoteProvider } from "./types";

export const ExportRemoteSchema = z.strictObject({
  name: z.string().min(1).max(255),
  namespace: z.string().min(1).optional(),
  private: z.boolean().default(true),
  branch: z.string().min(1).optional(),
}).readonly();
export type ExportRemote = z.infer<typeof ExportRemoteSchema>;

export async function prepareRemoteExport(input: {
  readonly services: AdapterServices;
  readonly store: RemoteGitStore;
  readonly provider: RemoteProvider;
  readonly parameters: ExportRemote;
  readonly context: ActionContext;
  readonly created: {
    readonly id: string;
    readonly url: string;
    readonly fullName: string;
    readonly defaultBranch: string;
  };
  readonly credentials: GitCredentials;
  readonly options?: RemoteGitOptions;
}): Promise<PreparedAction> {
  if (!input.context.projectId) {
    throw new ServiceError("PROJECT_REQUIRED", 400, "Export requires a project");
  }
  const existing = await input.services.context.db.get(
    "SELECT id FROM remote_bindings WHERE project_id=?",
    [input.context.projectId],
  );
  if (existing) {
    throw new ServiceError("REMOTE_BINDING_EXISTS", 409, "Project already has a remote Git binding");
  }
  const projects = new CoreProjects(input.services.context);
  const project = await projects.getProject(input.context.projectId);
  const branch = input.parameters.branch ?? project.defaultBranch;
  const scope = { projectId: project.id, branch };
  const lease = await input.services.context.branches.acquire(scope, crypto.randomUUID(), 60_000);
  if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Another writer owns this branch");
  const remote = await RemoteRepository.open({
    url: input.created.url,
    credentials: input.credentials,
    ...(input.options ? { options: input.options } : {}),
  });
  try {
    await recoverBranch(input.services.context, lease);
    await projects.authorize(input.context.actorId, scope, "git.push");
    const head = await new GitRepository(projects).head(input.context.actorId, scope, lease);
    await remote.importBundle(await input.services.context.repositories.exportNamed(project.id));
    await remote.push({
      source: `refs/heads/${branch}`,
      destination: `refs/heads/${branch}`,
    });
    const binding = input.store.bindingValue({
      projectId: project.id,
      provider: input.provider,
      grantId: input.context.grant.id,
      remoteUrl: input.created.url,
      branch,
      cursor: { localHead: remote.oid(head), remoteHead: remote.oid(head) },
    });
    const result = {
      repositoryId: input.created.id,
      fullName: input.created.fullName,
      bindingId: binding.id,
      branch,
      head: remote.oid(head),
    };
    return {
      result,
      cursor: JSON.stringify(binding.cursor),
      async publish(tx) {
        await tx.run(`INSERT INTO remote_bindings
          (id,project_id,provider,grant_id,remote_url,branch,cursor,version)
          VALUES(?,?,?,?,?,?,?,1)`, [
          binding.id,
          binding.projectId,
          binding.provider,
          binding.grantId,
          binding.remoteUrl,
          binding.branch,
          JSON.stringify(binding.cursor),
        ]);
      },
      async release() {
        await input.services.context.branches.release(lease);
        await remote[Symbol.asyncDispose]();
      },
    };
  } catch (error) {
    await input.services.context.branches.release(lease);
    await remote[Symbol.asyncDispose]();
    throw error;
  }
}
