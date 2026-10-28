import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Artifact } from "@quire/contracts";
import { editorValue } from "../shared";
import type { EditorClient, EditorWorkspace } from "../shared";

export type ArtifactData = {
  readonly bytes: Uint8Array;
  readonly url: string;
  readonly id: Artifact["id"];
  readonly name: string;
};
export function useArtifact(input: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly artifact: Artifact | null;
}) {
  const { client, workspace, artifact } = input;
  const [data, setData] = useState<ArtifactData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let url: string | null = null;
    setData(null);
    setError(null);
    if (artifact) {
      void client.call(endpoints.artifactContent, {
        params: { id: artifact.id }, query: {}, body: undefined, headers: workspace.requestHeaders,
      }, abort.signal).then(result => {
        const bytes = editorValue(result);
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: artifact.mime }));
        setData({ bytes, url, id: artifact.id, name: artifact.name });
      }).catch(cause => {
        if (!(cause instanceof Error)) throw cause;
        if (!abort.signal.aborted) setError(cause.message);
      });
    }
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [client, workspace, artifact?.id, artifact?.mime]);
  return { data: data?.id === artifact?.id ? data : null, error };
}

export async function downloadArtifact(input: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly artifact: Artifact;
}): Promise<void> {
  const bytes = editorValue(await input.client.call(endpoints.artifactContent, {
    params: { id: input.artifact.id }, query: {}, body: undefined,
    headers: input.workspace.requestHeaders,
  }));
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: input.artifact.mime }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = input.artifact.name;
    link.click();
  } finally { URL.revokeObjectURL(url); }
}
