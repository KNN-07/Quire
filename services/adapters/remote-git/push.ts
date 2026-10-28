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

export const PushRemoteSchema = z.strictObject({
  branch: z.string().min(1).optional(),
  expectedBindingVersion: z.number().int().nonnegative(),
}).readonly();
export type PushRemote = z.infer<typeof PushRemoteSchema>;

function raw(oid: `sha1:${string}` | `sha256:${string}`): string {
  return oid.slice(oid.indexOf(":") + 1);
}

export async function preparePush(input: {
  readonly services: AdapterServices;
  readonly store: RemoteGitStore;
  readonly provider: RemoteProvider;
  readonly parameters: PushRemote;
  readonly context: ActionContext;
  readonly credentials: GitCredentials;
  readonly options?: RemoteGitOptions;
}): Promise<PreparedAction> {
  if (!input.context.projectId) {
    throw new ServiceError("PROJECT_REQUIRED", 400, "Push requires a project");
  }
  const binding = await input.store.binding({
    actorId: input.context.actorId,
    projectId: input.context.projectId,
    provider: input.provider,
    grantId: input.context.grant.id,
  });
  if (binding.version !== input.parameters.expectedBindingVersion) {
    throw new ServiceError("VERSION_CONFLICT", 409, "Remote binding changed");
  }
  const branch = input.parameters.branch ?? binding.branch;
  if (branch !== binding.branch) {
    throw new ServiceError("REMOTE_BRANCH_MISMATCH", 409, "Push branch differs from the saved binding");
  }
  const remote = await RemoteRepository.open({
    url: binding.remoteUrl,
    credentials: input.credentials,
    ...(input.options ? { options: input.options } : {}),
  });
  const scope = { projectId: binding.projectId, branch };
  const lease = await input.services.context.branches.acquire(scope, crypto.randomUUID(), 60_000);
  if (!lease) {
    await remote[Symbol.asyncDispose]();
    throw new ServiceError("BRANCH_BUSY", 409, "Another writer owns this branch");
  }
  try {
    const projects = new CoreProjects(input.services.context);
    await recoverBranch(input.services.context, lease);
    await projects.authorize(input.context.actorId, scope, "git.push");
    const localHead = await new GitRepository(projects).head(input.context.actorId, scope, lease);
    const remoteHead = await remote.head(branch);
    await remote.importBundle(await input.services.context.repositories.exportNamed(binding.projectId));
    if (binding.cursor.conflictBranch) {
      const resolved = remoteHead === raw(binding.cursor.remoteHead)
        && await remote.isAncestor(remoteHead, localHead);
      if (!resolved) {
        throw new ServiceError("REMOTE_CONFLICT_PENDING", 409,
          `Resolve ${binding.cursor.conflictBranch} before pushing`);
      }
    }
    let result: Readonly<Record<string, unknown>>;
    let cursor;
    if (remoteHead !== raw(binding.cursor.remoteHead)) {
      const conflictBranch = `quire-conflict/${branch}-${localHead.slice(0, 12)}`;
      await remote.push({
        source: `refs/heads/${branch}`,
        destination: `refs/heads/${conflictBranch}`,
      });
      cursor = {
        localHead: remote.oid(localHead),
        remoteHead: remote.oid(remoteHead),
        conflictBranch,
      };
      result = {
        status: "conflict",
        head: remote.oid(localHead),
        remoteHead: remote.oid(remoteHead),
        conflictBranch,
      };
    } else {
      await remote.push({
        source: `refs/heads/${branch}`,
        destination: `refs/heads/${branch}`,
        expected: remoteHead,
      });
      cursor = {
        localHead: remote.oid(localHead),
        remoteHead: remote.oid(localHead),
      };
      result = { status: "pushed", head: remote.oid(localHead) };
    }
    return {
      result,
      cursor: JSON.stringify(cursor),
      async publish(tx) {
        const updated = await tx.run(
          "UPDATE remote_bindings SET cursor=?,version=version+1 WHERE id=? AND version=?",
          [JSON.stringify(cursor), binding.id, binding.version],
        );
        if (updated.changes !== 1) {
          throw new ServiceError("VERSION_CONFLICT", 409, "Remote binding changed");
        }
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
