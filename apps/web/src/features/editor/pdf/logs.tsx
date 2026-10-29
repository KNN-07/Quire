import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { CompileJob, Diagnostic } from "@quire/contracts";
import { Button, formatBytes } from "../../../ui";
import { editorValue } from "../shared";
import type { EditorClient, EditorNavigation, EditorWorkspace } from "../shared";
import { downloadArtifact } from "./artifact";
import toolchainsGuide from "../../../../../../docs/runbooks/toolchains.md?url";

export type DiagnosticFixRequest = {
  readonly key: string;
  readonly diagnostic: Diagnostic;
  readonly revision: number;
  readonly excerpt: string;
};

export function CompileLogs({ client, workspace, job, navigation, onError, onFixDiagnostic }: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly job: CompileJob | null;
  readonly navigation: EditorNavigation;
  readonly onError: (error: Error) => void;
  readonly onFixDiagnostic?: ((request: DiagnosticFixRequest) => void) | undefined;
}) {
  const [bytes, setBytes] = useState<Uint8Array>(new Uint8Array());
  const [rawView, setRawView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [severity, setSeverity] = useState<Diagnostic["severity"] | "all">("all");
  useEffect(() => {
    const abort = new AbortController();
    setBytes(new Uint8Array());
    setLoaded(false);
    if (job) void client.call(endpoints.compileLog, {
      params: { id: job.id }, query: {}, body: undefined, headers: workspace.requestHeaders,
    }, abort.signal).then(result => {
      const content = editorValue(result);
      if (!abort.signal.aborted) { setBytes(content); setLoaded(true); }
    }).catch(error => {
      if (!(error instanceof Error)) throw error;
      if (!abort.signal.aborted) onError(error);
    });
    return () => abort.abort();
  }, [client, workspace, job?.id, job?.status, onError]);
  if (!job) return <div className="q-pdf-body q-pdf-empty"><p>Compile this project to read diagnostics and generated files.</p></div>;
  const raw = new TextDecoder().decode(bytes);
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
          const excerpt = new TextDecoder().decode(bytes.subarray(item.rawStart, item.rawEnd));
          return <li key={item.id} data-severity={item.severity}>
            <header><strong className="q-pdf-severity">{item.severity}</strong><p>{item.message}</p></header>
            {excerpt.trim() && excerpt.trim() !== item.message.trim() && <pre>{excerpt}</pre>}
            <div className="q-pdf-diagnostic-actions">
            {item.fileId && <Button size="small" onClick={() => {
              if (item.fileId) run(navigation.revealSource({ fileId: item.fileId,
                line: Math.max(1, item.line ?? 1), column: Math.max(1, item.column ?? 1) }));
            }}>Go to {file?.path ?? "source"}:{item.line ?? 1}</Button>}
            {onFixDiagnostic && <Button size="small" variant="ai" disabled={!loaded || !workspace.access.capabilities.edit || !file?.editable}
              title={!workspace.access.capabilities.edit ? "Editing access is required" : !file?.editable ? "No editable source is linked" : "Choose context and consent before sending"}
              onClick={() => onFixDiagnostic({ key: crypto.randomUUID(), diagnostic: item, revision: job.snapshot.revision, excerpt })}>
              Fix with AI
            </Button>}
            </div>
          </li>;
        })}</ol> : <p>No {severity === "all" ? "" : `${severity} `}diagnostics reported.</p>}
      <h3>Output files</h3>
      <ul className="q-pdf-artifacts">{job.artifacts.map(artifact => <li key={artifact.id}>
        <Button size="small" onClick={() => run(downloadArtifact({ client, workspace, artifact }))}>
          Download {artifact.name} ({formatBytes(artifact.bytes)})
        </Button>
      </li>)}</ul>
      {!job.artifacts.length && <p>No generated files are available for this job.</p>}
      <details><summary>Compile optimization</summary>
        <p>Use draft mode to skip image rendering while editing. Check large images,
          recursive macros and externalization rules when a job times out. Clearing
          generated cache does not delete uploaded source assets.</p>
        <h3>Reuse pre-rendered TikZ figures</h3>
        <ol>
          <li>Pre-render with the configured restricted environment and its approved
            <code> quire-tikz </code> externalization rule. Recompile and confirm the job succeeds.</li>
          <li>Under Output files, download each figure's matching <code>.pdf</code>,
            <code> .md5</code> and <code> .dpth</code> files.</li>
          <li>Return to Files, open File actions and Upload files. Keep each original
            basename and path; these uploaded copies become persistent project assets.</li>
          <li>Use <code>{"\\tikzexternalize[mode=only graphics]"}</code> to include those
            pre-rendered figures without regenerating them, then Recompile. You can clear
            generated cache without deleting the uploaded copies.</li>
        </ol>
        <p>Regenerate and replace the matching asset set whenever figure source or numbering
          changes. Only-graphics mode does not refresh stale figures. Missing assets fail
          compilation; this workflow does not raise resource limits or guarantee a speedup.</p>
        <a href={toolchainsGuide} download="toolchains.md">Download toolchain and externalization guide</a>
      </details>
    </div>
  </>;
}
