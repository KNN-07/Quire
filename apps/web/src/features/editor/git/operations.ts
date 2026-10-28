import { endpoints } from "@quire/contracts";
import type { Operation } from "@quire/contracts";
import { editorValue } from "../shared";
import type { EditorClient, EditorWorkspace } from "../shared";
import type { CompareTarget, GitConflict, GitResolution, GitStatus } from "./types";

type Context = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
};
const key = () => ({ "idempotency-key": crypto.randomUUID() });

export async function stageHunks(input: {
  readonly context: Context;
  readonly status: GitStatus;
  readonly version: number;
  readonly hunkIds: readonly string[];
  readonly staged: boolean;
}): Promise<void> {
  editorValue(await input.context.client.call(endpoints.gitStage, {
    params: { p: input.context.workspace.scope.projectId }, query: {},
    body: {
      scope: input.context.workspace.scope, head: input.status.head,
      hunkIds: [...input.hunkIds], staged: input.staged, expectedVersion: input.version,
    },
    headers: {
      ...input.context.workspace.requestHeaders,
      "if-match": `"v${input.version}"`,
    },
  }));
}

export async function discardHunks(input: {
  readonly context: Context;
  readonly status: GitStatus;
  readonly version: number;
  readonly hunkIds: readonly string[];
}): Promise<void> {
  editorValue(await input.context.client.call(endpoints.gitDiscard, {
    params: { p: input.context.workspace.scope.projectId }, query: {},
    body: {
      scope: input.context.workspace.scope, head: input.status.head,
      hunkIds: [...input.hunkIds], expectedVersion: input.version,
    }, headers: input.context.workspace.requestHeaders,
  }));
}

export async function commitStaged(input: {
  readonly context: Context;
  readonly status: GitStatus;
  readonly version: number;
  readonly message: string;
  readonly compileFirst: boolean;
}): Promise<Operation> {
  return editorValue(await input.context.client.call(endpoints.gitCommit, {
    params: { p: input.context.workspace.scope.projectId }, query: {},
    body: {
      scope: input.context.workspace.scope, head: input.status.head,
      message: input.message, compileFirst: input.compileFirst, expectedVersion: input.version,
    }, headers: { ...input.context.workspace.requestHeaders, ...key() },
  }));
}

export async function createNamedBranch(input: {
  readonly context: Context;
  readonly version: number;
  readonly name: string;
}): Promise<void> {
  editorValue(await input.context.client.call(endpoints.gitBranchCreate, {
    params: { p: input.context.workspace.scope.projectId }, query: {},
    body: {
      name: input.name, from: input.context.workspace.scope.branch,
      expectedVersion: input.version,
    }, headers: { ...input.context.workspace.requestHeaders, ...key() },
  }));
}

export async function mergeNamedBranch(input: {
  readonly context: Context;
  readonly status: GitStatus;
  readonly version: number;
  readonly from: string;
}) {
  return editorValue(await input.context.client.call(endpoints.gitMerge, {
    params: { p: input.context.workspace.scope.projectId }, query: {},
    body: {
      scope: input.context.workspace.scope, head: input.status.head,
      from: input.from, expectedVersion: input.version,
    }, headers: { ...input.context.workspace.requestHeaders, ...key() },
  }));
}

export async function resolveMergeConflict(input: {
  readonly context: Context;
  readonly conflict: GitConflict;
  readonly resolutions: readonly GitResolution[];
}): Promise<Operation> {
  return editorValue(await input.context.client.call(endpoints.gitConflictResolve, {
    params: {
      p: input.context.workspace.scope.projectId,
      id: input.conflict.id,
    },
    query: {},
    body: {
      scope: input.conflict.scope, from: input.conflict.from, head: input.conflict.head,
      fromHead: input.conflict.fromHead, expectedVersion: input.conflict.version,
      resolutions: [...input.resolutions],
    },
    headers: { ...input.context.workspace.requestHeaders, ...key() },
  }));
}

export async function startRenderedComparison(input: {
  readonly context: Context;
  readonly status: GitStatus;
  readonly version: number;
  readonly target: CompareTarget;
}): Promise<Operation> {
  const { context, status, version, target } = input;
  const pair = editorValue(await context.client.call(endpoints.gitComparisonCreate, {
    params: { p: context.workspace.scope.projectId }, query: {},
    body: {
      scope: context.workspace.scope, head: status.head, target, expectedVersion: version,
    }, headers: { ...context.workspace.requestHeaders, ...key() },
  }));
  return editorValue(await context.client.call(endpoints.pdfDiff, {
    params: { p: context.workspace.scope.projectId }, query: {},
    body: { fromSnapshotId: pair.base.id, toSnapshotId: pair.target.id, mode: "side-by-side" },
    headers: { ...context.workspace.requestHeaders, ...key() },
  }));
}

export async function readRenderedComparison(input: {
  readonly context: Context; readonly operationId: string;
}) {
  const operation = editorValue(await input.context.client.call(endpoints.operationGet, {
    params: { id: input.operationId }, query: {}, body: undefined,
    headers: input.context.workspace.requestHeaders,
  }));
  if (operation.status !== "succeeded" || !operation.result) {
    return { operation, preview: null, artifactId: null };
  }
  const previewId = operation.result["previewArtifactId"];
  const artifactId = operation.result["artifactId"];
  if (typeof previewId !== "string" || typeof artifactId !== "string") {
    throw new TypeError("Rendered comparison result is incomplete");
  }
  const preview = editorValue(await input.context.client.call(endpoints.artifactContent, {
    params: { id: previewId }, query: {}, body: undefined,
    headers: input.context.workspace.requestHeaders,
  }));
  return { operation, preview, artifactId };
}

export async function downloadRenderedComparison(input: {
  readonly context: Context; readonly artifactId: string;
}): Promise<void> {
  const bytes = editorValue(await input.context.client.call(endpoints.artifactContent, {
    params: { id: input.artifactId }, query: {}, body: undefined,
    headers: input.context.workspace.requestHeaders,
  }));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${input.context.workspace.project.name}-git-diff.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function createGitToken(input: {
  readonly context: Context; readonly name: string; readonly expiresAt: string;
}): Promise<string> {
  const created = editorValue(await input.context.client.call(endpoints.gitTokenCreate, {
    params: {}, query: {}, body: { name: input.name, expiresAt: input.expiresAt }, headers: key(),
  }));
  return created.secretOnce;
}

export async function runRemoteAction(input: {
  readonly context: Context;
  readonly id: string;
  readonly action: "pull" | "fetch" | "push";
  readonly version: number;
}): Promise<Operation> {
  return editorValue(await input.context.client.call(endpoints.connectionAction, {
    params: { id: input.id }, query: {},
    body: {
      action: input.action, projectId: input.context.workspace.scope.projectId,
      parameters: { branch: input.context.workspace.scope.branch },
      expectedVersion: input.version,
    }, headers: key(),
  }));
}
