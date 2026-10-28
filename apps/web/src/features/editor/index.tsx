import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Preferences } from "@quire/contracts";
import { Button, Modal, Spinner } from "../../ui";
import { SourcePanel } from "./source";
import type { SourceToolsHandle } from "./source";
import { VisualPanel } from "./visual";
import { ToolsPanel } from "./tools";
import type { ToolPanel } from "./tools";
import { PdfPanel } from "./pdf";
import type { PdfPanelHandle } from "./pdf";
import { ReviewPanel } from "./review";
import { GitPanel } from "./git";
import { AssistantPanel } from "./assistant";
import { EditorApiError, parseEditorRoute } from "./shared";
import type { AuthoringHandle, CompileController, CompileState, EditorDocument, EditorLayout, EditorNavigation, EditorPageProps, EditorRoute, SourceLocation, SourceSelection } from "./shared";
import { EditorWorkspaceFrame } from "./workspace";
import { EditorSessionController } from "./session-controller";
import type { EditorSessionSnapshot } from "./session-controller";
import { EditorHeader, EditorRail, EditorRecovery, EditorSourceChrome, EditorStatus, useEditorMetadata } from "./chrome";
import type { EditorChromeActions, EditorChromeModel } from "./chrome";

const subscribeEmpty = () => () => undefined;
const snapshotEmpty = () => null;
const sessionLoading: EditorSessionSnapshot = { kind: "loading" };
export function EditorPage(props: EditorPageProps) {
  const route = parseEditorRoute(props.path);
  if (!route) return <main><h1>Project editor not found</h1><Button onClick={() => props.navigate("/projects")}>Back to projects</Button></main>;
  return <EditorSession {...props} route={route} key={`${route.projectId}:${route.branch ?? "main"}:${route.shareToken}`} />;
}
function EditorSession(props: EditorPageProps & { readonly route: EditorRoute }) {
  const { route, client } = props;
  const scopeKey = `${route.projectId}:${route.branch ?? "main"}:${route.shareToken}`;
  const [controller, setController] = useState<EditorSessionController | null>(null);
  const session = useSyncExternalStore(controller?.subscribe ?? subscribeEmpty, controller?.getSnapshot ?? (() => sessionLoading));
  const loaded = session.kind === "ready" ? session : null;
  const pendingLocation = useRef<SourceLocation | null>(null);
  const activeAuthoring = useRef<{ readonly document: EditorDocument; readonly handle: AuthoringHandle } | null>(null);
  const viewer = useRef<PdfPanelHandle | null>(null);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [working, setWorking] = useState(false);
  const [layout, setLayout] = useState<EditorLayout>("split");
  const [tool, setTool] = useState<ToolPanel>("files");
  const [toolsOpen, setToolsOpen] = useState(() => matchMedia("(min-width:1024px)").matches);
  const [assistantOpen, setAssistantOpen] = useState(() => matchMedia("(min-width:1280px)").matches);
  const [dialog, setDialog] = useState<"share" | "chat" | null>(null);
  const [selection, setSelection] = useState<SourceSelection>({ anchor: 0, head: 0 });
  const [authoring, setAuthoring] = useState<AuthoringHandle | null>(null);
  const [sourceTools, setSourceTools] = useState<SourceToolsHandle | null>(null);
  const [compile, setCompile] = useState<CompileController | null>(null);
  const [compilation, setCompilation] = useState<CompileState>({ job: null, preview: null });
  const snapshot = useSyncExternalStore(loaded?.document?.subscribe ?? subscribeEmpty, loaded?.document?.getSnapshot ?? snapshotEmpty);
  const metadata = useEditorMetadata(client, loaded?.workspace ?? null);
  const report = useCallback((cause: unknown) => { if (cause instanceof Error) setError(cause.message); else throw cause; }, []);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(""); setWorking(true);
    try { await action(); } catch (cause) { report(cause); } finally { setWorking(false); }
  }, [report]);
  useEffect(() => {
    let active = true;
    const next = new EditorSessionController(client, route);
    setController(next); setError("");
    void next.start().then(() => {
      const value = next.getSnapshot();
      if (active && value.kind === "ready") setLayout(value.preferences.defaultView);
    }).catch(cause => { if (active) report(cause); });
    return () => { active = false; void next.dispose().catch(cause => window.reportError(cause)); };
  }, [client, scopeKey, generation, report]);
  const refreshWorkspace = useCallback(async () => {
    if (!controller) throw new EditorApiError("EDITOR_LOADING", "The editor is still connecting");
    if (await controller.refresh()) setSelection({ anchor: 0, head: 0 });
  }, [controller]);
  const go = useCallback(async (page: EditorRoute["page"], branch?: string) => {
    if (!controller) throw new EditorApiError("EDITOR_LOADING", "The editor is still connecting");
    props.navigate(await controller.path(page, branch));
  }, [controller, props.navigate]);
  const navigation = useMemo<EditorNavigation>(() => ({
    async openFile(fileId) {
      if (!controller) throw new EditorApiError("EDITOR_LOADING", "The editor is still connecting");
      await controller.openFile(fileId); setSelection({ anchor: 0, head: 0 });
      setLayout(currentLayout => currentLayout === "pdf" ? "split" : currentLayout);
      if (!["edit", "logs", "review"].includes(route.page)) await go("edit");
    },
    changeBranch: branch => go("edit", branch),
    revealPdf: location => {
      if (!viewer.current) throw new EditorApiError("PDF_LOADING", "The PDF viewer is still connecting");
      viewer.current.reveal(location);
    },
    async revealSource(location) {
      if (!controller) throw new EditorApiError("EDITOR_LOADING", "The editor is still connecting");
      await controller.openFile(location.fileId);
      pendingLocation.current = location;
      const value = controller.getSnapshot();
      const text = value.kind === "ready" ? value.document?.source.toJSON() ?? "" : "";
      const prefix = text.split("\n").slice(0, location.line - 1);
      const at = prefix.reduce((sum, line) => sum + line.length + 1, 0) + location.column - 1;
      setSelection({ anchor: at, head: at });
      setLayout(currentLayout => currentLayout === "pdf" ? "split" : currentLayout);
      if (value.kind === "ready" && activeAuthoring.current?.document === value.document) {
        activeAuthoring.current.handle.reveal(location); pendingLocation.current = null;
      }
      if (!["edit", "logs", "review"].includes(route.page)) await go("edit");
    },
  }), [controller, go, route.page]);
  const onHandle = useCallback((handle: AuthoringHandle | null) => {
    activeAuthoring.current = handle && loaded?.document ? { handle, document: loaded.document } : null;
    setAuthoring(handle);
    if (handle && pendingLocation.current) { handle.reveal(pendingLocation.current); pendingLocation.current = null; }
  }, [loaded?.document]);
  const recompile = useCallback(async () => {
    if (!viewer.current) throw new EditorApiError("COMPILER_LOADING", "Compilation is still connecting");
    await viewer.current.recompile();
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.isComposing || !controller || controller.getSnapshot().kind !== "ready" || window.document.querySelector("dialog[open]")) return;
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void run(recompile); }
      else if (event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void run(controller.settle); }
      else if (event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); setTool("search"); setAssistantOpen(false); setToolsOpen(true); }
    };
    const leaving = (event: BeforeUnloadEvent) => {
      const value = controller?.getSnapshot();
      const status = value?.kind === "ready" ? value.document?.getSnapshot().persistence : null;
      if (value?.kind === "ready" && (value.retained.length || status && status.kind !== "saved" && status.kind !== "connecting")) event.preventDefault();
    };
    window.addEventListener("keydown", key, true); window.addEventListener("beforeunload", leaving);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("beforeunload", leaving); };
  }, [run, recompile, controller]);
  if (!loaded || !controller) return <main className="qe-loading"><h1>Project editor</h1>{error ? <><p role="alert">{error}</p><Button onClick={() => setGeneration(value => value + 1)}>Retry editor</Button></> : <Spinner label="Opening project editor" />}</main>;
  const { workspace, document, preferences } = loaded;
  const common = { client, workspace, document, navigation, refreshWorkspace };
  const diagnostics = compilation.job?.diagnostics ?? [];
  const onPreferencesChange = (value: Preferences) => {
    if (value.defaultView !== preferences.defaultView) setLayout(value.defaultView);
    controller.updatePreferences(value);
    window.document.documentElement.dataset["theme"] = value.theme;
    void props.onSessionChange().catch(report);
  };
  const source = document ? { ...common, document, preferences, selection, onSelectionChange: setSelection, onPreferencesChange, onHandle, diagnostics } : null;
  const chooseTool = (next: ToolPanel) => { setAssistantOpen(false); setToolsOpen(value => tool === next ? !value : true); setTool(next); };
  const prefix = document?.source.toJSON().slice(0, selection.head).split("\n") ?? [];
  const location: SourceLocation | null = document ? { fileId: document.file.id, line: prefix.length, column: (prefix.at(-1)?.length ?? 0) + 1 } : null;
  const actions: EditorChromeActions = {
    navigate: page => { void run(() => go(page)); },
    projects: () => { void run(async () => {
      if (!controller) throw new EditorApiError("EDITOR_LOADING", "The editor is still connecting");
      await controller.settle(); await controller.dispose(); props.navigate("/projects");
    }); },
    layout: setLayout, tool: chooseTool,
    assistant: () => { if (matchMedia("(max-width:1023px)").matches) setToolsOpen(false); setAssistantOpen(value => !value); },
    share: () => { setAssistantOpen(false); if (matchMedia("(max-width:1023px)").matches) setToolsOpen(false); setDialog("share"); },
    chat: () => { setAssistantOpen(false); if (matchMedia("(max-width:1023px)").matches) setToolsOpen(false); setDialog("chat"); },
    join: () => { void run(controller.join); },
    compile: () => { void run(recompile); },
    cancel: () => { void run(async () => { if (!compile) throw new EditorApiError("COMPILER_LOADING", "Compilation is still connecting"); await compile.cancel(); }); },
    sourceToPdf: () => { void run(async () => {
      if (!viewer.current || !location) throw new EditorApiError("NO_PREVIEW", "Compile a PDF and select a source location first");
      await viewer.current.forward(location); if (layout === "source") setLayout("split");
    }); },
  };
  const model: EditorChromeModel = { session: loaded, page: route.page, layout, tool, toolsOpen, assistantOpen, snapshot, compilation, location, compilerAvailable: compile !== null, working };
  const header = <><EditorHeader model={model} actions={actions} metadata={metadata} />
    {error && <p className="qe-message" role="alert">{error}</p>}
    <EditorRecovery retained={loaded.retained} discard={controller.discardRecovery} copy={text => { void run(() => navigator.clipboard.writeText(text)); }} /></>;
  return <><EditorWorkspaceFrame userId={loaded.userId} page={route.page} layout={layout}
    toolsOpen={toolsOpen} onToolsOpenChange={value => { if (value) setAssistantOpen(false); setToolsOpen(value); }}
    assistantOpen={assistantOpen} onAssistantOpenChange={value => { if (value) setToolsOpen(false); setAssistantOpen(value); }}
    rail={<EditorRail model={model} actions={actions} metadata={metadata} />}
    slots={{ header, tools: <ToolsPanel {...common} filesPresentation="compact" authoring={authoring} panel={tool} onPanelChange={setTool} onPreferencesChange={onPreferencesChange} onSessionChange={props.onSessionChange} />,
      source: source ? <div className="qe-source"><EditorSourceChrome document={source.document} tools={sourceTools} readOnly={snapshot?.readOnly ?? true} />
        <SourcePanel {...source} presentation="embedded" onToolsHandle={setSourceTools} /></div> : <p className="qe-message">No editable text file is selected. Open Files to create or select one.</p>,
      visual: source ? <VisualPanel {...source} /> : <p className="qe-message">Select an editable text file to use Visual.</p>,
      pdf: <PdfPanel {...common} presentation="embedded" preferences={preferences} onController={setCompile} onCompileStateChange={setCompilation} onViewer={value => { viewer.current = value; }} view={route.page === "logs" ? "logs" : route.page === "pdf-diff" ? "diff" : "pdf"} />,
      review: <ReviewPanel {...common} selection={selection} view={route.page === "history" ? "history" : "review"} />,
      git: <GitPanel {...common} />,
      assistant: <AssistantPanel {...common} selection={selection} compile={compile} diagnostics={diagnostics} />,
      status: <EditorStatus model={model} actions={actions} metadata={metadata} />,
    }} />
    {dialog && <Modal open className={dialog === "share" ? "qe-share-dialog" : "qe-chat-dialog"} title={dialog === "share" ? `Share “${workspace.project.name}”` : "Project chat"} onClose={() => setDialog(null)}
      footer={<Button onClick={() => setDialog(null)}>Done</Button>}><ReviewPanel {...common} selection={selection} view={dialog} /></Modal>}</>;
}
