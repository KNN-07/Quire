import { z } from "zod";
import { GitOidSchema, IdSchema, OperationSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import { recoverBranch } from "../../core/base/source-recovery";
import { GitRepository } from "../../core/git";
import { treeInputs } from "../../core/git/trees";
import type { AdapterServices, ActionContext, PreparedAction } from "../shared";
import { RemoteRepository } from "./git-process";
import type { GitCredentials, RemoteGitOptions } from "./git-process";
import type { RemoteGitStore } from "./store";
import type { RemoteProvider } from "./types";

export const PullRemoteSchema = z.strictObject({
  branch: z.string().min(1).optional(),
  expectedBindingVersion: z.number().int().nonnegative(),
}).readonly();
export type PullRemote = z.infer<typeof PullRemoteSchema>;

function raw(oid: `sha1:${string}` | `sha256:${string}`): string {
  return oid.slice(oid.indexOf(":") + 1);
}

async function updateOnly(input: {
  readonly services: AdapterServices;
  readonly bindingId: string;
  readonly expectedVersion: number;
  readonly cursor: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
}): Promise<PreparedAction> {
  return {
    result: input.result,
    cursor: JSON.stringify(input.cursor),
    async publish(tx) {
      const updated = await tx.run(
        "UPDATE remote_bindings SET cursor=?,version=version+1 WHERE id=? AND version=?",
        [JSON.stringify(input.cursor), input.bindingId, input.expectedVersion],
      );
      if (updated.changes !== 1) {
        throw new ServiceError("VERSION_CONFLICT", 409, "Remote binding changed");
      }
    },
  };
}

export async function preparePull(input: {
  readonly services: AdapterServices;
  readonly store: RemoteGitStore;
  readonly provider: RemoteProvider;
  readonly parameters: PullRemote;
  readonly context: ActionContext;
  readonly credentials: GitCredentials;
  readonly options?: RemoteGitOptions;
}): Promise<PreparedAction> {
  if (!input.context.projectId) {
    throw new ServiceError("PROJECT_REQUIRED", 400, "Pull requires a project");
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
    throw new ServiceError("REMOTE_BRANCH_MISMATCH", 409, "Pull branch differs from the saved binding");
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
  let secondaryLease: typeof lease | null = null;
  try {
    const projects = new CoreProjects(input.services.context);
    await recoverBranch(input.services.context, lease);
    await projects.authorize(input.context.actorId, scope, "git.write");
    const repository = new GitRepository(projects);
    const localHead = await repository.head(input.context.actorId, scope, lease);
    const remoteHead = await remote.head(branch);
    if (binding.cursor.conflictBranch) {
      const resolved = remoteHead === raw(binding.cursor.remoteHead)
        && await remote.isAncestor(remoteHead, localHead);
      if (!resolved) {
        throw new ServiceError("REMOTE_CONFLICT_PENDING", 409,
          `Resolve ${binding.cursor.conflictBranch} before synchronizing again`);
      }
    }
    if (remoteHead === localHead || await remote.isAncestor(remoteHead, localHead)) {
      const cursor = {
        localHead: remote.oid(localHead),
        remoteHead: remote.oid(remoteHead),
      };
      await input.services.context.branches.release(lease);
      await remote[Symbol.asyncDispose]();
      return updateOnly({
        services: input.services,
        bindingId: binding.id,
        expectedVersion: binding.version,
        cursor,
        result: { status: remoteHead === localHead ? "up-to-date" : "local-ahead", head: remote.oid(localHead) },
      });
    }
    await input.services.context.repositories.importPack(binding.projectId, Buffer.from(await remote.pack()));
    const fastForward = await remote.isAncestor(localHead, remoteHead);
    const targetScope = fastForward
      ? scope
      : { projectId: scope.projectId, branch: `${branch}-remote-conflict-${remoteHead.slice(0, 12)}` };
    const targetLease = fastForward
      ? lease
      : await input.services.context.branches.acquire(targetScope, crypto.randomUUID(), 60_000);
    if (!targetLease) {
      throw new ServiceError("BRANCH_BUSY", 409, "Remote conflict branch is busy");
    }
    if (!fastForward) secondaryLease = targetLease;
    const source = await projects.prepareSource({
      actorId: input.context.actorId,
      scope: targetScope,
      lease: targetLease,
      expectedRevision: fastForward ? (await projects.getBranch(scope)).revision : 0,
      inputs: await treeInputs(projects, { scope: targetScope, commit: remoteHead }),
      reason: "commit",
      ...(!fastForward ? { newBranchId: IdSchema.parse(crypto.randomUUID()) } : {}),
    });
    const cursor = {
      localHead: remote.oid(fastForward ? remoteHead : localHead),
      remoteHead: remote.oid(remoteHead),
      ...(!fastForward ? { conflictBranch: targetScope.branch } : {}),
    };
    const result = fastForward
      ? { status: "pulled", head: remote.oid(remoteHead) }
      : { status: "conflict", head: remote.oid(localHead), remoteHead: remote.oid(remoteHead),
        conflictBranch: targetScope.branch };
    const operation = OperationSchema.parse({
      ...(await input.store.operation(input.context.actorId, input.context.key)),
      status: "succeeded",
      progress: 1,
      result,
      errorCode: null,
    });
    const intentId = IdSchema.parse(crypto.randomUUID());
    const payload = {
      source,
      binding: { ...binding, cursor, version: binding.version + 1 },
      heads: { [targetScope.branch]: remoteHead },
      operation,
      cursor: JSON.stringify(cursor),
    };
    await input.store.journal({
      id: intentId,
      actorId: input.context.actorId,
      grantId: input.context.grant.id,
      action: "pull",
      projectId: binding.projectId,
      payload,
    });
    await input.services.context.repositories.publish({
      id: intentId,
      lease: targetLease,
      updates: [
        {
          ref: `refs/heads/${targetScope.branch}`,
          expected: fastForward ? GitOidSchema.parse(`sha1:${localHead}`) : null,
          next: GitOidSchema.parse(`sha1:${remoteHead}`),
        },
        {
          ref: `refs/quire/history/${source.snapshot.id}`,
          expected: null,
          next: GitOidSchema.parse(`sha1:${source.commit}`),
        },
      ],
    });
    return {
      result,
      cursor: JSON.stringify(cursor),
      async publish(tx) {
        const events = await projects.finalizePreparedSources(tx, {
          publication: { id: intentId, lease: targetLease },
          sources: [{ source, lease: targetLease }],
        });
        await input.store.finalizeDomain(tx, {
          intentId,
          payload,
          events: [
            ...events,
            {
              topic: "git.changed",
              aggregateId: binding.projectId,
              payload: { resourceId: binding.projectId, version: source.snapshot.revision },
            },
          ],
        });
      },
      async release() {
        if (!fastForward) await input.services.context.branches.release(targetLease);
        await input.services.context.branches.release(lease);
        await remote[Symbol.asyncDispose]();
      },
    };
  } catch (error) {
    if (secondaryLease) await input.services.context.branches.release(secondaryLease);
    await input.services.context.branches.release(lease);
    await remote[Symbol.asyncDispose]();
    throw error;
  }
}
