import { z } from "zod";
import {
  FileEntrySchema,
  GitOidSchema,
  IdSchema,
  OperationSchema,
  ProjectSchema,
} from "@quire/contracts";
import type { FileEntry, Project } from "@quire/contracts";
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
}).readonly();
export type ImportRemote = z.infer<typeof ImportRemoteSchema>;

function text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0")
      ? null
      : new TextDecoder().decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function entries(files: readonly {
  readonly path: string;
  readonly bytes: Uint8Array;
}[]): readonly {
  readonly file: FileEntry;
  readonly bytes: Uint8Array;
}[] {
  return files.map((entry) => ({
    file: FileEntrySchema.parse({
      id: IdSchema.parse(crypto.randomUUID()),
      path: entry.path,
      kind: "file",
      mime: text(entry.bytes) === null ? "application/octet-stream" : "text/plain",
      blob: null,
      bytes: entry.bytes.byteLength,
      editable: text(entry.bytes) !== null,
      version: { revision: 0, epoch: 0 },
      link: null,
    }),
    bytes: entry.bytes,
  }));
}

async function projectValue(
  services: AdapterServices,
  context: ActionContext,
  input: ImportRemote,
  files: readonly { readonly file: FileEntry; readonly bytes: Uint8Array }[],
): Promise<Project> {
  if (input.workspaceId && !await services.context.db.get(
    "SELECT 1 FROM members WHERE organization_id=? AND user_id=?",
    [input.workspaceId, context.actorId],
  )) {
    throw new ServiceError("FORBIDDEN", 403, "Workspace membership required");
  }
  const main = files.find((entry) =>
    entry.file.path.endsWith(".tex") && text(entry.bytes)?.includes("\\documentclass"));
  if (!main) {
    throw new ServiceError("INVALID_MAIN", 422,
      "Remote repository needs an editable TeX main containing documentclass");
  }
  const environment = z.object({ id: IdSchema }).parse(await services.context.db.get(
    `SELECT id FROM environments WHERE retired_at IS NULL
     ORDER BY available DESC,is_default DESC,created_at DESC,id LIMIT 1`,
  ));
  const now = services.context.clock.now();
  return ProjectSchema.parse({
    id: IdSchema.parse(crypto.randomUUID()),
    name: input.name,
    ownerId: context.actorId,
    workspaceId: input.workspaceId ?? null,
    defaultBranch: input.branch,
    settings: {
      engine: "pdflatex",
      mainFileId: main.file.id,
      environmentId: environment.id,
      draft: false,
      stopOnFirstError: false,
    },
    version: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export async function prepareRemoteImport(input: {
  readonly services: AdapterServices;
  readonly store: RemoteGitStore;
  readonly provider: RemoteProvider;
  readonly parameters: ImportRemote;
  readonly context: ActionContext;
  readonly credentials?: { readonly username: string; readonly password: string };
  readonly options?: RemoteGitOptions;
}): Promise<PreparedAction> {
  const remote = await RemoteRepository.open({
    url: input.parameters.url,
    ...(input.credentials ? { credentials: input.credentials } : {}),
    ...(input.options ? { options: input.options } : {}),
  });
  let lease: Awaited<ReturnType<typeof input.services.context.branches.acquire>> | null = null;
  try {
    const head = await remote.head(input.parameters.branch);
    const sourceFiles = entries(await remote.files(head));
    const project = await projectValue(input.services, input.context, input.parameters, sourceFiles);
    const scope = { projectId: project.id, branch: input.parameters.branch };
    await input.services.context.repositories.initialize(project.id);
    await input.services.context.repositories.importPack(project.id, Buffer.from(await remote.pack()));
    lease = await input.services.context.branches.acquire(scope, crypto.randomUUID(), 60_000);
    if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Another writer owns the imported branch");
    const branchId = IdSchema.parse(crypto.randomUUID());
    const projects = new CoreProjects(input.services.context);
    const source = await projects.prepareSource({
      actorId: input.context.actorId,
      scope,
      lease,
      expectedRevision: 0,
      inputs: sourceFiles,
      reason: "import",
      creation: { project, branchId },
    });
    const branches = await remote.branches();
    const tags = await remote.tags();
    const binding = input.store.bindingValue({
      projectId: project.id,
      provider: input.provider,
      grantId: input.context.grant.id,
      remoteUrl: input.parameters.url,
      branch: input.parameters.branch,
      cursor: { localHead: remote.oid(head), remoteHead: remote.oid(head) },
    });
    const result = {
      projectId: project.id,
      bindingId: binding.id,
      branch: input.parameters.branch,
      head: remote.oid(head),
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
      heads,
      operation,
      cursor: JSON.stringify(binding.cursor),
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
      cursor: JSON.stringify(binding.cursor),
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
