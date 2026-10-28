import { useCallback, useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Operation, ResponseOf } from "@quire/contracts";
import { EditorApiError } from "../shared";
import type { GitPanelProps } from "../shared";
import type { CompareTarget, GitBranch, GitConflict, GitLog, GitResolution, GitStatus } from "./types";
import {
  createGitToken, downloadRenderedComparison, readRenderedComparison,
  runRemoteAction, startRenderedComparison, stageHunks, discardHunks,
  commitStaged, createNamedBranch, mergeNamedBranch, resolveMergeConflict,
} from "./operations";

type RenderedState = {
  readonly target: CompareTarget;
  readonly operation: Operation;
  readonly previewUrl: string | null;
  readonly artifactId: string | null;
};
type WorkspaceState = {
  readonly status: GitStatus | null;
  readonly version: number | null;
  readonly branches: readonly GitBranch[];
  readonly log: GitLog;
  readonly connections: ResponseOf<typeof endpoints.connectionsList>["items"];
  readonly availability: ResponseOf<typeof endpoints.connectionAvailability>;
};
const emptyState: WorkspaceState = {
  status: null, version: null, branches: [], log: [], connections: [], availability: {},
};

export function useGitWorkspace(props: GitPanelProps) {
  const [state, setState] = useState<WorkspaceState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<GitConflict | null>(null);
  const [rendered, setRendered] = useState<RenderedState | null>(null);
  const [tokenSecret, setTokenSecret] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const project = {
      params: { p: props.workspace.scope.projectId },
      query: { branch: props.workspace.scope.branch },
      body: undefined,
      headers: props.workspace.requestHeaders,
    };
    const [status, branches, log] = await Promise.all([
      props.client.callWithMetadata(endpoints.gitStatus, project, signal),
      props.client.call(endpoints.gitBranches, project, signal),
      props.client.call(endpoints.gitLog, {
        ...project, query: { ...project.query, limit: 50 },
      }, signal),
    ]);
    const [connections, availability] = await Promise.all([
      props.client.call(endpoints.connectionsList, {
        params: {}, query: { limit: 200 }, body: undefined,
      }, signal),
      props.client.call(endpoints.connectionAvailability, {
        params: {}, query: {}, body: undefined,
      }, signal),
    ]);
    if ("error" in status.result) {
      throw new EditorApiError(status.result.error.code,
        `Git status: ${status.result.error.message} ${JSON.stringify(status.result.error.details ?? {})}`);
    }
    if ("error" in branches) {
      throw new EditorApiError(branches.error.code,
        `Git branches: ${branches.error.message} ${JSON.stringify(branches.error.details ?? {})}`);
    }
    if ("error" in log) {
      throw new EditorApiError(log.error.code,
        `Git log: ${log.error.message} ${JSON.stringify(log.error.details ?? {})}`);
    }
    const remoteError = "error" in connections ? connections.error : "error" in availability ? availability.error : null;
    setState({
      status: status.result.data,
      version: status.metadata.expectedVersion,
      branches: branches.data,
      log: log.data.items,
      connections: "error" in connections ? [] : connections.data.items,
      availability: remoteError ? {
        git: {
          enabled: false, state: "unconfigured",
          reason: `Remote adapters unavailable: ${remoteError.message}`,
        },
      } : "error" in availability ? {} : availability.data,
    });
  }, [props.client, props.workspace]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal).then(() => {
      if (!controller.signal.aborted) { setLoading(false); setError(""); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        if (cause instanceof Error) setError(cause.message);
        else throw cause;
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [load]);
  useEffect(() => () => {
    if (rendered?.previewUrl) URL.revokeObjectURL(rendered.previewUrl);
  }, [rendered?.previewUrl]);

  const run = useCallback(async (action: () => Promise<string | void>) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await props.document?.flush();
      const result = await action();
      await load();
      if (result) setMessage(result);
      return true;
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message);
      else throw cause;
      return false;
    } finally {
      setBusy(false);
    }
  }, [load, props.document]);

  const mutation = () => {
    const status = state.status;
    const version = state.version;
    if (!status || version === null) throw new TypeError("Git status is not loaded");
    return { status, version };
  };

  return {
    ...state, loading, busy, error, message, conflict, rendered, tokenSecret,
    reload: () => run(async () => { await load(); return "Git status refreshed."; }),
    switchBranch: (branch: string) => run(async () => {
      await props.navigation.changeBranch(branch);
    }),
    stage: (hunkIds: readonly string[], staged: boolean) => run(async () => {
      const current = mutation();
      await stageHunks({
        context: { client: props.client, workspace: props.workspace },
        ...current, hunkIds, staged,
      });
    }),
    discard: (hunkIds: readonly string[]) => run(async () => {
      const current = mutation();
      await discardHunks({
        context: { client: props.client, workspace: props.workspace },
        ...current, hunkIds,
      });
      await props.refreshWorkspace();
      return "Selected browser changes discarded.";
    }),
    commit: (input: { readonly message: string; readonly compileFirst: boolean }) => run(async () => {
      const current = mutation();
      const operation = await commitStaged({
        context: { client: props.client, workspace: props.workspace },
        ...current, ...input,
      });
      return operation.status === "succeeded" ? "Commit created." : `Commit ${operation.status}.`;
    }),
    createBranch: async (name: string) => {
      const created = await run(async () => {
        const current = mutation();
        await createNamedBranch({
          context: { client: props.client, workspace: props.workspace },
          version: current.version, name,
        });
        return `Created branch ${name}.`;
      });
      if (created) await props.navigation.changeBranch(name);
      return created;
    },
    merge: (from: string) => run(async () => {
      const current = mutation();
      const result = await mergeNamedBranch({
        context: { client: props.client, workspace: props.workspace },
        ...current, from,
      });
      if (result.kind === "conflict") {
        setConflict(result.conflict);
        return "Resolve every conflicted file before completing the merge.";
      }
      setConflict(null);
      await props.refreshWorkspace();
      return "Branch merged.";
    }),
    resolve: (resolutions: readonly GitResolution[]) => run(async () => {
      if (!conflict) throw new TypeError("No merge conflict is open");
      await resolveMergeConflict({
        context: { client: props.client, workspace: props.workspace },
        conflict, resolutions,
      });
      setConflict(null);
      await props.refreshWorkspace();
      return "Merge conflict resolved and committed.";
    }),
    compare: (target: CompareTarget) => run(async () => {
      const current = mutation();
      const operation = await startRenderedComparison({
        context: { client: props.client, workspace: props.workspace },
        status: current.status, version: current.version, target,
      });
      setRendered(previous => {
        if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
        return { target, operation, previewUrl: null, artifactId: null };
      });
      return "Rendered comparison started.";
    }),
    refreshRendered: () => run(async () => {
      if (!rendered) throw new TypeError("No rendered comparison is running");
      const result = await readRenderedComparison({
        context: { client: props.client, workspace: props.workspace },
        operationId: rendered.operation.id,
      });
      if (!result.preview || !result.artifactId) {
        setRendered({ ...rendered, operation: result.operation });
        return result.operation.status === "failed"
          ? `Rendered comparison failed: ${result.operation.errorCode ?? "unknown"}.`
          : `Rendered comparison ${result.operation.status}.`;
      }
      const previewUrl = URL.createObjectURL(new Blob([result.preview], { type: "image/png" }));
      setRendered(previous => {
        if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
        return {
          target: rendered.target, operation: result.operation,
          previewUrl, artifactId: result.artifactId,
        };
      });
      return "Rendered comparison ready.";
    }),
    downloadRendered: () => run(async () => {
      if (!rendered?.artifactId) throw new TypeError("Rendered comparison is not ready");
      await downloadRenderedComparison({
        context: { client: props.client, workspace: props.workspace },
        artifactId: rendered.artifactId,
      });
    }),
    createToken: (input: { readonly name: string; readonly expiresAt: string }) => run(async () => {
      setTokenSecret(await createGitToken({
        context: { client: props.client, workspace: props.workspace }, ...input,
      }));
      return "Git token created. Copy it now.";
    }),
    clearToken: () => setTokenSecret(""),
    remoteAction: (input: {
      readonly id: string; readonly action: "pull" | "fetch" | "push"; readonly version: number;
    }) => run(async () => {
      const operation = await runRemoteAction({
        context: { client: props.client, workspace: props.workspace }, ...input,
      });
      return `Remote ${input.action} ${operation.status}.`;
    }),
    clearConflict: () => setConflict(null),
  };
}
