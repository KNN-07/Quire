import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { CompileJob, Diagnostic } from "@quire/contracts";
import { Button } from "../../../ui";
import { editorValue } from "../shared";
import type { EditorClient, EditorNavigation, EditorWorkspace } from "../shared";
import { downloadArtifact } from "./artifact";

export function CompileLogs({ client, workspace, job, navigation, onError }: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly job: CompileJob | null;
  readonly navigation: EditorNavigation;
  readonly onError: (error: Error) => void;
}) {
  const [raw, setRaw] = useState("");
  const [rawView, setRawView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [severity, setSeverity] = useState<Diagnostic["severity"] | "all">("all");
  useEffect(() => {
    const abort = new AbortController();
    setRaw("");
    setLoaded(false);
    if (job) void client.call(endpoints.compileLog, {
      params: { id: job.id }, query: {}, body: undefined, headers: workspace.requestHeaders,
    }, abort.signal).then(result => {
      const bytes = editorValue(result);
      if (!abort.signal.aborted) { setRaw(new TextDecoder().decode(bytes)); setLoaded(true); }
    }).catch(error => {
      if (!(error instanceof Error)) throw error;
      if (!abort.signal.aborted) onError(error);
    });
    return () => abort.abort();
  }, [client, workspace, job?.id, job?.status, onError]);
  if (!job) return <div className="q-pdf-body"><p>Compile this project to read diagnostics and generated files.</p></div>;
  const diagnostics = job.diagnostics.filter(item => severity === "all" || item.severity === severity);
  const run = (action: Promise<void>) => void action.catch(error => {
    if (error instanceof Error) onError(error); else throw error;
  });
  return <>
    <div className="q-pdf-toolbar" role="group" aria-label="Diagnostic filters">
      {(["all", "error", "warning", "typesetting"] as const).map(value =>
        <Button key={value} aria-pressed={severity === value} onClick={() => setSeverity(value)}>
          {value === "all" ? "All" : value === "error" ? "Errors" : value === "warning" ? "Warnings" : "Typesetting"}
          {" "}({job.diagnostics.filter(item => value === "all" || item.severity === value).length})
        </Button>)}
      <Button aria-pressed={rawView} onClick={() => setRawView(!rawView)}>{rawView ? "Parsed diagnostics" : "Raw log"}</Button>
    </div>
    <div className="q-pdf-body q-pdf-log">
      {rawView ? <pre aria-label="Raw compiler log" aria-busy={!loaded}>
        {loaded ? raw || "The compiler produced no log bytes." : "Loading compiler log…"}</pre> :
        diagnostics.length ? <ol className="q-pdf-diagnostics">{diagnostics.map(item => {
          const file = workspace.files.find(entry => entry.id === item.fileId);
          return <li key={item.id}>
            <strong>{item.severity}</strong><p>{item.message}</p>
            {item.fileId && <Button onClick={() => {
              if (item.fileId) run(navigation.revealSource({ fileId: item.fileId,
                line: Math.max(1, item.line ?? 1), column: Math.max(1, item.column ?? 1) }));
            }}>Go to {file?.path ?? "source"}:{item.line ?? 1}</Button>}
            <pre>{raw.slice(item.rawStart, item.rawEnd)}</pre>
          </li>;
        })}</ol> : <p>No {severity === "all" ? "" : `${severity} `}diagnostics reported.</p>}
      <h3>Output files</h3>
      <ul>{job.artifacts.map(artifact => <li key={artifact.id}>
        <Button onClick={() => run(downloadArtifact({ client, workspace, artifact }))}>
          Download {artifact.name} ({artifact.bytes.toLocaleString()} bytes)
        </Button>
      </li>)}</ul>
      {!job.artifacts.length && <p>No generated files are available for this job.</p>}
      <details><summary>Compile optimization</summary>
        <p>Use draft mode to skip image rendering while editing. Check large images,
          recursive macros and externalization rules when a job times out. Clearing
          generated cache does not delete uploaded source assets.</p>
      </details>
    </div>
  </>;
}
