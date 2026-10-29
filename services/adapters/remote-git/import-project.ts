import { z } from "zod";
import {
  GitOidSchema,
  IdSchema,
  ImportSelectionSchema,
  OperationSchema,
  ProjectSchema,
} from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import type { AdapterServices, ActionContext, PreparedAction } from "../shared";
import { RemoteRepository } from "./git-process";
import type { RemoteGitOptions } from "./git-process";
import type { RemoteGitStore } from "./store";
import type { RemoteProvider } from "./types";

export const ImportRemoteSchema = z.strictObject({
  name: z.string().min(1).max(255),
  url: z.url(),
  branch: z.string().min(1),
  workspaceId: IdSchema.optional(),
  ...ImportSelectionSchema.unwrap().shape,
}).readonly();
export type ImportRemote = z.infer<typeof ImportRemoteSchema>;

export async function prepareRemoteImport(input: {
  readonly services: AdapterServices;
  readonly store: RemoteGitStore;
  readonly provider: RemoteProvider;
  readonly parameters: ImportRemote;
  readonly context: ActionContext;
  readonly credentials?: { readonly username: string; readonly password: string };
  readonly options?: RemoteGitOptions;
}): Promise<PreparedAction> {
  const preserveHistory = input.parameters.preserveHistory ?? true;
  const keepConnected = input.parameters.keepConnected ?? true;
  if (!preserveHistory && keepConnected) throw new ServiceError("REMOTE_HISTORY_REQUIRED", 422,
    "Keep full history to retain a pull/push connection, or import an independent snapshot.");
  const remote = await RemoteRepository.open({
    url: input.parameters.url,
    ...(input.credentials ? { credentials: input.credentials } : {}),
    ...(input.options ? { options: input.options } : {}),
  });
  let lease: Awaited<ReturnType<typeof input.services.context.branches.acquire>> | null = null;
  try {
    const head = await remote.head(input.parameters.branch);
    const projects = new CoreProjects(input.services.context);
    const creation = await projects.prepareCreation(input.context.actorId, {
      name: input.parameters.name, entries: await remote.files(head),
      ...(input.parameters.workspaceId ? { workspaceId: input.parameters.workspaceId } : {}),
      ...(input.parameters.mainPath ? { mainPath: input.parameters.mainPath } : {}),
      ...(input.parameters.engine ? { engine: input.parameters.engine } : {}),
      ...(input.parameters.environmentId ? { environmentId: input.parameters.environmentId } : {}),
    });
    const project = ProjectSchema.parse({ ...creation.project, defaultBranch: input.parameters.branch });
    const scope = { projectId: project.id, branch: input.parameters.branch };
    await input.services.context.repositories.initialize(project.id);
    if (preserveHistory) await input.services.context.repositories.importPack(project.id, Buffer.from(await remote.pack()));
    lease = await input.services.context.branches.acquire(scope, crypto.randomUUID(), 60_000);
    if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Another writer owns the imported branch");
    const branchId = creation.branchId;
    const source = await projects.prepareSource({
      actorId: input.context.actorId,
      scope,
      lease,
      expectedRevision: 0,
      inputs: creation.inputs,
      reason: "import",
      creation: { project, branchId },
    });
    const branches = preserveHistory ? await remote.branches() : new Map([[input.parameters.branch, source.commit]]);
    const tags = preserveHistory ? await remote.tags() : new Map<string, string>();
    const localHead = preserveHistory ? head : source.commit;
    const binding = input.store.bindingValue({
      projectId: project.id,
      provider: input.provider,
      grantId: input.context.grant.id,
      remoteUrl: input.parameters.url,
      branch: input.parameters.branch,
      cursor: { localHead: remote.oid(localHead), remoteHead: remote.oid(head) },
    });
    const result = {
      projectId: project.id,
      bindingId: keepConnected ? binding.id : null,
      branch: input.parameters.branch,
      head: remote.oid(localHead),
      preserveHistory, keepConnected,
      branches: [...branches.keys()],
      tags: [...tags.keys()],
    };
    const operation = OperationSchema.parse({
      ...(await input.store.operation(input.context.actorId, input.context.key)),
      status: "succeeded",
      progress: 1,
      result,
      errorCode: null,
    });
    const intentId = IdSchema.parse(crypto.randomUUID());
    const heads = Object.fromEntries(branches);
    const payload = {
      source,
      project,
      binding,
      connected: keepConnected,
      heads,
      operation,
      cursor: null,
    };
    await input.store.journal({
      id: intentId,
      actorId: input.context.actorId,
      grantId: input.context.grant.id,
      action: "import",
      projectId: project.id,
      payload,
    });
    await input.services.context.repositories.publish({
      id: intentId,
      lease,
      updates: [
        ...[...branches].map(([branch, oid]) => ({
          ref: `refs/heads/${branch}`,
          expected: null,
          next: GitOidSchema.parse(`sha1:${oid}`),
        })),
        ...[...tags].map(([tag, oid]) => ({
          ref: `refs/tags/${tag}`,
          expected: null,
          next: GitOidSchema.parse(`sha1:${oid}`),
        })),
        {
          ref: `refs/quire/history/${source.snapshot.id}`,
          expected: null,
          next: GitOidSchema.parse(`sha1:${source.commit}`),
        },
      ],
    });
    const acquired = lease;
    return {
      result,
      cursor: null,
      async publish(tx) {
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
          [branchId, project.id, project.defaultBranch, project.createdAt, project.updatedAt],
        );
        await tx.run(
          "INSERT INTO repositories(project_id,relative_path,created_at) VALUES(?,?,?)",
          [project.id, `git/${project.id}.git`, project.createdAt],
        );
        const events = await projects.finalizePreparedSources(tx, {
          publication: { id: intentId, lease: acquired },
          sources: [{ source, lease: acquired }],
        });
        await input.store.finalizeDomain(tx, {
          intentId,
          payload,
          events: [
            ...events,
            {
              topic: "git.changed",
              aggregateId: project.id,
              payload: { resourceId: project.id, version: 1 },
            },
          ],
        });
      },
      async release() {
        await input.services.context.branches.release(acquired);
        await remote[Symbol.asyncDispose]();
      },
    };
  } catch (error) {
    if (lease) await input.services.context.branches.release(lease);
    await remote[Symbol.asyncDispose]();
    throw error;
  }
}
