import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { assertNever, endpoints } from "@quire/contracts";
import type { Diagnostic } from "@codemirror/lint";
import { UndoManager } from "yjs";
import { Button, Modal } from "../../../ui";
import { editorValue } from "../shared";
import type { SourcePanelProps, SourceTool } from "../shared";
import { createSourceEditor, sourceCommand } from "./editor";
import type { SourceEditor } from "./editor";
import { lineOffset, texIndex } from "./tex";
import type { TexIndex } from "./tex";
import { codeCheck } from "./check";
import { getCodeCheckEnabled, subscribeCodeCheck } from "./check-state";
import { SourceFind } from "./Find";
import { SourceSettings } from "./Settings";
import { SourceDiagnostics } from "./Diagnostics";
import { projectCompletionIndex } from "./project-index";
import { sourceCatalog } from "./locale";
import type { SourceLanguage } from "./locale";
import { useSpelling } from "./use-spelling";
import { SpellingStatus } from "./SpellingStatus";
import { clipboardImage } from "../visual/media";
import { prepareImagePaste } from "../visual/upload";
import { draftChange, draftKey, readDraft } from "./tracking";
import { useSourceTracking } from "./use-tracking";
import { SourceProposals } from "./Proposals";
import { useInlineReferences } from "./InlineReferences";
import "./source.css";

const emptyIndex: TexIndex = { headings: [], labels: [], citations: [] };
export function SourcePanel(props: SourcePanelProps) {
  return <SourcePanelContent key={draftKey(props.workspace, props.document)} {...props} />;
}
function SourcePanelContent(props: SourcePanelProps) {
  const parent = useRef<HTMLDivElement>(null);
  const toolHeading = useRef<HTMLHeadingElement>(null);
  const latest = useRef(props);
  const imageUpload = useRef<AbortController | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  latest.current = props;
  const [editor, setEditor] = useState<SourceEditor | null>(null);
  const [source, setSource] = useState(() => props.document.source.toJSON());
  const [tool, setTool] = useState<SourceTool | null>(null);
  const [language, setLanguage] = useState<SourceLanguage>("en");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [keysLoading, setKeysLoading] = useState(false);
  const [discard, setDiscard] = useState(false);
  const sharedUndo = useMemo(() => new UndoManager(props.document.source), [props.document]);
  const otherIndex = useRef<TexIndex>(emptyIndex);
  const currentIndex = useMemo(() => texIndex(source), [source]);
  const completionIndex = useRef<TexIndex>(emptyIndex);
  completionIndex.current = {
    headings: currentIndex.headings,
    labels: [...new Set([...otherIndex.current.labels, ...currentIndex.labels])],
    citations: [...new Set([...otherIndex.current.citations, ...currentIndex.citations])],
  };
  const snapshot = useSyncExternalStore(props.document.subscribe, props.document.getSnapshot, props.document.getSnapshot);
  const tracking = useSourceTracking(props, snapshot);
  const inlineReferences = useInlineReferences(props, editor, tracking.draft.enabled);
  const trackingLatest = useRef(tracking);
  trackingLatest.current = tracking;
  const readOnly = tracking.draft.enabled ? !tracking.editable : snapshot.readOnly;
  const change = draftChange(tracking.draft.base, tracking.draft.text);
  const checkEnabled = useSyncExternalStore(subscribeCodeCheck, getCodeCheckEnabled, getCodeCheckEnabled);
  const copy = sourceCatalog[language];
  const online = snapshot.persistence.kind === "saved" || snapshot.persistence.kind === "saving";
  useEffect(() => () => imageUpload.current?.abort(), [props.document]);
  useEffect(() => () => sharedUndo.destroy(), [sharedUndo]);
  useEffect(() => { if (tracking.draft.enabled) imageUpload.current?.abort(); }, [tracking.draft.enabled]);
  useEffect(() => {
    const node = parent.current;
    if (!node) return undefined;
    const initial = trackingLatest.current.draft.enabled ? trackingLatest.current.draft.text : props.document.source.toJSON();
    otherIndex.current = emptyIndex;
    completionIndex.current = texIndex(initial);
    setSource(initial);
    const created = createSourceEditor({
      parent: node, document: props.document, preferences: latest.current.preferences, sharedUndo,
      externalInsertionBlocked: () => readDraft(draftKey(latest.current.workspace, latest.current.document), latest.current.document).enabled,
      index: () => completionIndex.current, selection: latest.current.selection,
      remoteCompletion: inlineReferences.completion,
      onCompletionContextChange: inlineReferences.invalidate,
      ...(trackingLatest.current.draft.enabled ? { draft: {
        text: initial, canEdit: () => trackingLatest.current.editable,
      } } : {}),
      onChange: value => {
        setSource(value);
        if (trackingLatest.current.draft.enabled) trackingLatest.current.change(value);
      }, onFind: () => setTool("find"),
      onSelection: selection => {
        // Draft offsets do not address the committed Y.Text used by Review and Assistant.
        if (!trackingLatest.current.draft.enabled) latest.current.onSelectionChange(selection);
      },
    });
    setEditor(created);
    latest.current.onHandle(created.handle);
    return () => { latest.current.onHandle(null); created.destroy(); };
  }, [props.document, tracking.generation, sharedUndo]);
  useEffect(() => { editor?.preferences(props.preferences); }, [editor, props.preferences]);
  useEffect(() => { editor?.access(); }, [editor, readOnly]);
  useEffect(() => {
    if (!editor) return undefined;
    props.onToolsHandle?.({
      open: setTool,
      close: () => { setTool(null); editor.handle.focus(); },
      format: command => { editor.handle.focus(); return sourceCommand(editor.view, command); },
      readOnly,
    });
    return () => props.onToolsHandle?.(null);
  }, [editor, props.onToolsHandle, readOnly]);
  useEffect(() => { if (tool && tool !== "find") toolHeading.current?.focus(); }, [tool]);
  useEffect(() => {
    if (!editor || tracking.draft.enabled) return;
    const selection = editor.view.state.selection.main;
    if (selection.anchor !== props.selection.anchor || selection.head !== props.selection.head) editor.handle.select(props.selection);
  }, [editor, props.selection, tracking.draft.enabled]);
  useEffect(() => {
    const controller = new AbortController();
    void props.client.call(endpoints.me, { params: {}, query: {}, body: undefined }, controller.signal)
      .then(result => setLanguage(editorValue(result).user.interfaceLanguage))
      .catch((cause: unknown) => { if (controller.signal.aborted) return; if (cause instanceof Error) setError(cause.message); else throw cause; });
    return () => controller.abort();
  }, [props.client]);
  useEffect(() => {
    if (!online) { setKeysLoading(false); return undefined; }
    const controller = new AbortController();
    setKeysLoading(true); setError("");
    void projectCompletionIndex(props, controller.signal).then(index => {
      otherIndex.current = index;
      const current = texIndex(latest.current.document.source.toJSON());
      completionIndex.current = { headings: current.headings, labels: [...new Set([...index.labels, ...current.labels])], citations: [...new Set([...index.citations, ...current.citations])] };
    }).catch((cause: unknown) => { if (controller.signal.aborted) return; if (cause instanceof Error) setError(cause.message); else throw cause; })
      .finally(() => { if (!controller.signal.aborted) setKeysLoading(false); });
    return () => controller.abort();
  }, [props.client, props.workspace, props.document, refresh, online]);
  const checks = useMemo(() => codeCheck(source, { enabled: checkEnabled }), [source, checkEnabled]);
  const spelling = useSpelling(source, props.preferences);
  useEffect(() => {
    if (!editor) return;
    const compiler: Diagnostic[] = props.diagnostics.flatMap(diagnostic => {
      if (diagnostic.fileId !== props.document.file.id || diagnostic.line === null) return [];
      const from = lineOffset(source, { line: diagnostic.line, column: diagnostic.column ?? 1 });
      const first = Array.from(source.slice(from))[0] ?? "";
      let severity: Diagnostic["severity"];
      switch (diagnostic.severity) {
        case "error": severity = "error"; break;
        case "warning": case "typesetting": severity = "warning"; break;
        default: return assertNever(diagnostic.severity);
      }
      return [{ from, to: from + first.length, severity,
        source: "Compiler", message: diagnostic.message }];
    });
    editor.diagnostics([...checks, ...spelling.issues, ...compiler]);
  }, [editor, source, props.document, props.diagnostics, checks, spelling.issues]);
  return <section className="q-source-panel" aria-label={copy.source} lang={language} data-presentation={props.presentation ?? "standalone"} data-theme={props.preferences.theme} data-spelling-state={spelling.state.kind}
    data-tracking={tracking.draft.enabled ? "on" : "off"} data-tracking-permission={tracking.canTrack ? "allowed" : "denied"}
    data-tracking-state={tracking.conflict && tracking.dirty ? "conflict" : !tracking.online ? "offline" : tracking.busy ? "submitting" : tracking.dirty ? "draft" : "ready"}>
    {props.presentation !== "embedded" && <><header className="q-source-toolbar">
      <strong className="q-source-filename" title={props.document.file.path}>{props.document.file.path}</strong>
      <div className="q-source-row">{(["find", "outline", "check", "preferences", "shortcuts"] as const).map(name =>
        <Button key={name} size="small" variant="ghost" aria-pressed={tool === name} onClick={() => setTool(tool === name ? null : name)}>{copy[name]}</Button>)}</div>
    </header>
    <div className="q-source-format q-source-row" aria-label="Source formatting">
      <Button size="small" disabled={!editor || readOnly} title="Bold (Ctrl/Cmd+B)" onClick={() => editor && sourceCommand(editor.view, "bold")}>Bold</Button>
      <Button size="small" disabled={!editor || readOnly} title="Italic (Ctrl/Cmd+I)" onClick={() => editor && sourceCommand(editor.view, "italic")}>Italic</Button>
      <Button size="small" disabled={!editor || readOnly} onClick={() => editor && sourceCommand(editor.view, "inline-math")}>{copy.math}</Button>
      <Button size="small" disabled={!editor || readOnly} onClick={() => editor && sourceCommand(editor.view, "display-math")}>{copy.displayMath}</Button>
    </div></>}
    <div className="q-source-tracking">
      <div className="q-source-row">
        <Button size="small" aria-pressed={tracking.draft.enabled}
          disabled={tracking.busy || imageBusy || !tracking.draft.enabled && (!tracking.canTrack || !tracking.online)}
          onClick={tracking.toggle}>Track changes {tracking.draft.enabled ? "on" : "off"}</Button>
        {tracking.draft.enabled && <Button size="small" variant="primary" busy={tracking.busy}
          disabled={!tracking.canTrack || !tracking.online || !tracking.dirty || tracking.conflict && !tracking.draft.submission}
          onClick={() => void tracking.submit()}>{tracking.draft.submission ? "Retry proposal submission" : "Submit proposal"}</Button>}
        {tracking.dirty && <Button size="small" disabled={tracking.busy} onClick={() => setDiscard(true)}>Discard local draft…</Button>}
      </div>
      <p role="status">{!tracking.canTrack ? "Proposing requires review permission and the owner's Track Changes benefit."
        : tracking.draft.submission ? "Submission outcome pending. Retry the same request; your draft is retained."
          : tracking.conflict && tracking.dirty ? "Source changed. Your draft is retained and cannot overwrite newer source."
            : tracking.draft.enabled ? "Local proposal draft. Submit explicitly to share for review; shared source stays unchanged."
              : tracking.dirty ? "Tracking paused. Your unsubmitted draft is retained; turn tracking on to resume." : "Direct editing. Turn on tracking to propose source changes."}</p>
      {tracking.draft.enabled && <p>Project file changes, citation copies, images, external insertions and Visual editing are unavailable while tracking. Text typing, paste, formatting and Find replace edit this draft.</p>}
      {!tracking.online && tracking.draft.enabled && <p>Reconnect and wait for source acknowledgment before editing or submitting. Your draft is retained.</p>}
      {tracking.dirty && <details className="q-source-draft" open>
        <summary>Your unsubmitted source changes</summary>
        <pre aria-label="Local proposed source changes"><del>{change.before}</del><ins>{change.after}</ins></pre>
        <details><summary>Recover complete draft text</summary><textarea readOnly aria-label="Retained proposal draft" value={tracking.draft.text} /></details>
      </details>}
      {tracking.error && <p role="alert">{tracking.error}</p>}
    </div>
    {snapshot.readOnlyReason && !tracking.draft.enabled && <p className="q-source-notice" role="status">{snapshot.readOnlyReason}</p>}
    {inlineReferences.controls}
    {inlineReferences.status}
    {tool !== "check" && tool !== "preferences" && <SpellingStatus state={spelling.state} compact />}
    <div ref={parent} className="q-source-editor" onPasteCapture={event => {
      if (!Array.from(event.clipboardData.items).some(item => item.kind === "file")) return;
      event.preventDefault(); event.stopPropagation();
      if (tracking.draft.enabled) { setError("Image insertion is unavailable while Track changes is on. Paste text to propose it."); return; }
      if (!editor || snapshot.readOnly || imageUpload.current) return;
      let file: File | null;
      try { file = clipboardImage(event.clipboardData); }
      catch (failure) { if (!(failure instanceof Error)) throw failure; setError(failure.message); return; }
      if (!file) return;
      const controller = new AbortController();
      imageUpload.current = controller;
      const document = props.document;
      const selected = editor.view.state.selection.main;
      setImageBusy(true); setError("");
      void prepareImagePaste(props, file, { anchor: selected.anchor, head: selected.head }, controller.signal).then(edits => {
        if (controller.signal.aborted || latest.current.document !== document) return;
        // A single native input transaction keeps package insertion and figure undo together.
        editor.view.dispatch({ changes: edits, userEvent: "input.paste", scrollIntoView: true });
      }).catch((failure: unknown) => {
        if (!(failure instanceof Error)) throw failure;
        if (!controller.signal.aborted) setError(failure.message);
      }).finally(() => {
        if (imageUpload.current === controller) { imageUpload.current = null; setImageBusy(false); }
      });
    }} />
    {imageBusy && <p role="status">Converting and uploading clipboard image as PNG… <Button onClick={() => imageUpload.current?.abort()}>Cancel upload</Button></p>}
    {tool && editor && <aside className="q-source-tools" aria-label={copy[tool]} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); setTool(null); editor.handle.focus(); }
    }}>
      <div className="q-source-row"><h2 ref={toolHeading} tabIndex={-1}>{copy[tool]}</h2><Button size="small" onClick={() => { setTool(null); editor.handle.focus(); }}>{copy.close}</Button></div>
      {tool === "find" && <SourceFind editor={editor} copy={copy} readOnly={readOnly} />}
      {tool === "outline" && (currentIndex.headings.length ? <nav aria-label="Current file headings"><ol className="q-source-list">{currentIndex.headings.map(heading =>
        <li key={heading.from} style={{ paddingInlineStart: `calc(var(--q-space-3) * ${Math.max(0, heading.level - 2)})` }}><Button variant="ghost" onClick={() => { editor.handle.select({ anchor: heading.from, head: heading.to }); editor.handle.focus(); }}>{heading.title}</Button></li>)}</ol></nav> : <p>{copy.noHeadings}</p>)}
      {tool === "check" && <SourceDiagnostics props={props} editor={editor} issues={checks} copy={copy} spelling={spelling} />}
      {tool === "preferences" && <><SpellingStatus state={spelling.state} /><SourceSettings props={props} copy={copy} onLanguage={setLanguage} /></>}
      {tool === "shortcuts" && <div className="q-source-stack">
        <dl className="q-source-shortcuts"><dt>Find / replace</dt><dd>Ctrl/Cmd+F; Ctrl+H (Windows/Linux)</dd><dt>Bold / italic / comment</dt><dd>Ctrl/Cmd+B / I / /</dd><dt>Completion</dt><dd>Ctrl+Space; Option+Space on Mac if the OS reserves Ctrl+Space</dd><dt>Undo / redo</dt><dd>Ctrl/Cmd+Z / Shift+Z</dd><dt>Indent / outdent</dt><dd>Tab / Shift+Tab</dd><dt>Close tools / completion</dt><dd>Escape</dd></dl>
        <Button disabled={!online} busy={keysLoading} onClick={() => setRefresh(value => value + 1)}>{copy.refresh}</Button>
        <p>Commands show required packages in completion details. Labels and bibliography keys come from current project files.</p>
      </div>}
    </aside>}
    <SourceProposals {...props} />
    {discard && <Modal open title="Discard local proposal draft?" onClose={() => setDiscard(false)}
      footer={<><Button onClick={() => setDiscard(false)}>Keep draft</Button><Button variant="danger" onClick={() => { tracking.discard(); setDiscard(false); }}>Discard draft</Button></>}>
      <p>Copy the retained text first if you need it. This removes only your local draft, never a submitted proposal. If a submission reply was lost, check Review for its persisted result.</p>
    </Modal>}
    {error && <p className="q-source-notice" role="alert">{error}</p>}
  </section>;
}
