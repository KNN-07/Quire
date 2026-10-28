import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Tabs } from "../../../ui";
import type { CompileJob, CompileSettings } from "@quire/contracts";
import { EditorApiError } from "../shared";
import type { CompileState, PdfLocation, PdfPanelProps, SourceLocation } from "../shared";
import { useArtifact } from "./artifact";
import { PdfCompileController } from "./controller";
import { CompileLogs } from "./logs";
import { forwardSync, reverseSync } from "./navigation";
import { PdfViewer } from "./viewer";
import { PdfComparison } from "./comparison";
import "./pdf.css";

export type PdfPanelHandle = {
  readonly reveal: (location: PdfLocation) => void;
  readonly forward: (location: SourceLocation) => Promise<void>;
  readonly recompile: () => Promise<CompileJob>;
};
export type PdfPanelOptions = PdfPanelProps & {
  readonly presentation?: "standalone" | "embedded";
  readonly view?: "pdf" | "logs" | "diff";
  readonly onViewer?: (handle: PdfPanelHandle | null) => void;
  readonly sourceLocation?: SourceLocation;
};
const empty: CompileState = { job: null, preview: null };
const noop = () => () => {};
export function PdfPanel(props: PdfPanelOptions) {
  const { engine, mainFileId, environmentId, draft, stopOnFirstError } = props.workspace.project.settings;
  const baseSettings = useMemo<CompileSettings>(() => ({ engine, mainFileId, environmentId, draft, stopOnFirstError }),
    [engine, mainFileId, environmentId, draft, stopOnFirstError]);
  const [controller, setController] = useState<PdfCompileController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [action, setAction] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [automatic, setAutomatic] = useState(props.preferences.autoCompile);
  const [settings, setSettings] = useState<CompileSettings>(baseSettings);
  const [browser, setBrowser] = useState(props.preferences.viewer === "browser");
  const [location, setLocation] = useState<PdfLocation | null>(null);
  const [tab, setTab] = useState(props.view ?? "pdf");
  const callbacks = useRef(props);
  callbacks.current = props;
  const live = useRef({ controller, settings, loading });
  live.current = { controller, settings, loading };
  const recompile = useCallback(async (): Promise<CompileJob> => {
    const current = live.current;
    if (!current.controller || current.loading) throw new EditorApiError("COMPILER_NOT_READY", "Wait for compilation discovery");
    const { workspace } = callbacks.current;
    return current.controller.compile({ scope: workspace.scope, expectedRevision: workspace.access.branchRevision,
      settings: current.settings, clean: false });
  }, []);
  const onError = useCallback((cause: Error) => setError(cause.message), []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const next = new PdfCompileController({ client: props.client, get workspace() { return callbacks.current.workspace; },
      document: props.document, onError: cause => { if (active) onError(cause); } });
    setController(next);
    callbacks.current.onController(next);
    void next.ready.then(() => { if (active) setLoading(false); }).catch(cause => {
      if (!(cause instanceof Error)) throw cause;
      if (active) { setError(cause.message); setLoading(false); }
    });
    return () => { active = false; callbacks.current.onController(null); void next.dispose(); };
  }, [props.client, props.workspace.scope.projectId, props.workspace.scope.branch,
    props.workspace.requestHeaders["x-project-token"], props.document, generation, onError]);
  const state = useSyncExternalStore(controller?.subscribe ?? noop, controller?.getSnapshot ?? (() => empty));
  const documentState = useSyncExternalStore(props.document?.subscribe ?? noop,
    props.document?.getSnapshot ?? (() => null));
  useEffect(() => { callbacks.current.onCompileStateChange(state); }, [state]);
  useEffect(() => { if (props.view) setTab(props.view); }, [props.view]);
  useEffect(() => { controller?.configureAutomatic(automatic, settings); },
    [controller, automatic, settings, props.workspace.access.capabilities.compile]);
  useEffect(() => { setAutomatic(props.preferences.autoCompile); }, [props.preferences.autoCompile]);
  useEffect(() => { setBrowser(props.preferences.viewer === "browser"); }, [props.preferences.viewer]);
  useEffect(() => { setSettings(baseSettings); }, [baseSettings]);
  const artifact = state.preview?.artifact ?? null;
  const { data, error: artifactError } = useArtifact({ client: props.client, workspace: props.workspace, artifact });
  const previewJobId = artifact?.jobId;
  const forward = useCallback(async (source: SourceLocation) => {
    if (!previewJobId) throw new EditorApiError("NO_PREVIEW", "Compile a PDF before navigating");
    const targets = await forwardSync({ client: props.client, workspace: props.workspace, jobId: previewJobId }, source);
    const target = targets[0];
    if (!target) throw new EditorApiError("NO_SYNCTEX_MATCH", "No PDF location matches this source line");
    setLocation(target);
  }, [props.client, props.workspace, previewJobId]);
  useEffect(() => {
    const handle: PdfPanelHandle = {
      reveal: setLocation,
      forward,
      recompile,
    };
    callbacks.current.onViewer?.(handle);
    return () => callbacks.current.onViewer?.(null);
  }, [forward, recompile]);
  const busy = state.job?.status === "running" || state.job?.status === "queued";
  const persistence = documentState?.persistence;
  const offline = persistence?.kind === "offline" || persistence?.kind === "recovery" || persistence?.kind === "closed";
  const canCompile = props.workspace.access.capabilities.compile && !offline && !loading;
  const run = async (operation: () => Promise<unknown>) => {
    setAction(true); setError(null); setNotice(null);
    try { await operation(); }
    catch (cause) { if (cause instanceof Error) setError(cause.message); else throw cause; }
    finally { setAction(false); }
  };
  const dirty = persistence && persistence.kind !== "saved";
  const sourceAhead = persistence?.kind === "saved" && state.preview !== null
    && persistence.revision > state.preview.snapshot.revision;
  const stale = state.preview?.stale || dirty || sourceAhead;
  const failed = state.job && ["failed", "timeout", "canceled"].includes(state.job.status);
  const reverse = async (target: PdfLocation) => {
    if (!previewJobId) return;
    const targets = await reverseSync({ client: props.client, workspace: props.workspace, jobId: previewJobId }, target);
    const source = targets[0];
    if (!source) throw new EditorApiError("NO_SYNCTEX_MATCH", "No source location matches this PDF point");
    await props.navigation.revealSource(source);
  };
  const viewerChoice = <label className="q-pdf-viewer-choice">Viewer <select aria-label="Viewer" value={browser ? "browser" : "builtin"}
    onChange={event => setBrowser(event.target.value === "browser")}>
    <option value="builtin">Built-in PDF.js</option><option value="browser">Browser</option>
  </select></label>;
  const controls = <div className="q-pdf-toolbar">
      <Button variant={tab === "diff" ? "neutral" : "primary"} disabled={!canCompile || busy || action}
        onClick={() => void run(recompile)}>Recompile</Button>
      <Button disabled={!canCompile || !busy || action} onClick={() => void run(async () => controller?.cancel())}>Cancel compile</Button>
      <label><input type="checkbox" checked={automatic} disabled={!canCompile}
        onChange={event => {
          controller?.configureAutomatic(event.target.checked, settings); setAutomatic(event.target.checked);
        }} />Automatic compile</label>
      <label><input type="checkbox" checked={settings.draft} disabled={!canCompile}
        onChange={event => {
          const next = { ...settings, draft: event.target.checked };
          controller?.configureAutomatic(automatic, next); setSettings(next);
        }} />Draft (skip images)</label>
      <label><input type="checkbox" checked={settings.stopOnFirstError} disabled={!canCompile}
        onChange={event => {
          const next = { ...settings, stopOnFirstError: event.target.checked };
          controller?.configureAutomatic(automatic, next); setSettings(next);
        }} />Stop on first error</label>
      <Button disabled={!canCompile || busy || action} onClick={() => void run(async () => {
        await controller?.clearCache(); setNotice("Generated cache cleared. Uploaded source assets are unchanged.");
      })}>Clear generated cache</Button>
      {props.presentation === "embedded" && viewerChoice}
    </div>;
  const quietStatus = props.presentation === "embedded" && state.job?.status === "succeeded" && !stale && !offline && !notice;
  return <section className="q-pdf-panel" aria-label="Compilation and PDF" data-presentation={props.presentation ?? "standalone"}>
    {props.presentation === "embedded" ? <details className="q-pdf-options" onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }}><summary>PDF options</summary>{controls}</details> : controls}
    <div className={`q-pdf-status${quietStatus ? " q-sr-only" : ""}`} role="status" aria-live="polite"
      data-compile-status={state.job?.status ?? "uncompiled"} data-preview-stale={stale}>
      {loading ? "Discovering compilation…" : state.job ?
        `Compile ${state.job.status} · revision ${state.job.snapshot.revision}${state.job.elapsedMs === null ? "" : ` · ${(state.job.elapsedMs / 1000).toFixed(2)} s`}${state.job.failureCode ? ` · ${state.job.failureCode}` : ""}` :
        "No compilation yet. Recompile to create a PDF."}
      {state.preview && <p>{failed ? "Compilation did not succeed. PDF remains the last successful build." :
        stale ? "PDF is stale: it does not represent current saved source." : "PDF matches the latest successful compilation."}
        {" "}PDF source revision {state.preview.snapshot.revision}.</p>}
      {offline && <p>Reconnect and save source before compiling.</p>}
      {notice && <p>{notice}</p>}
    </div>
    {(error || artifactError) && <div className="q-pdf-error" role="alert">
      <p>{error ?? artifactError}</p>
      <Button onClick={() => setGeneration(generation + 1)}>Reconnect and reload</Button>
    </div>}
    <Tabs label="PDF workspace" value={tab} onValueChange={value => {
      if (value === "pdf" || value === "logs" || value === "diff") setTab(value);
    }} items={[
      { value: "pdf", label: "PDF", content: <div className="q-pdf-content">
        {(props.presentation !== "embedded" || props.sourceLocation) && <div className="q-pdf-toolbar">
        {props.presentation !== "embedded" && viewerChoice}
        {props.sourceLocation && <Button disabled={!previewJobId || offline} onClick={() => {
          const source = props.sourceLocation;
          if (source) void run(() => forward(source));
        }}>Source to PDF</Button>}
        </div>}
        {data ? <PdfViewer compact={props.presentation === "embedded"} data={data} browser={browser} location={location} onReverse={reverse} onError={onError} /> :
          <div className="q-pdf-body"><p>{artifact ? "Loading compiled PDF…" : "No successful PDF available. Recompile this project."}</p></div>}
      </div> },
      { value: "logs", label: "Logs", content: tab === "logs" ? <div className="q-pdf-content"><CompileLogs client={props.client}
        workspace={props.workspace} job={state.job} navigation={props.navigation} onError={onError} /></div> : null },
      { value: "diff", label: "PDF comparison", content: tab === "diff" ? <PdfComparison client={props.client}
        workspace={props.workspace} onError={onError} /> : null },
    ]} />
  </section>;
}
