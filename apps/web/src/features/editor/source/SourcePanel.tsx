import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { assertNever, endpoints } from "@quire/contracts";
import type { Diagnostic } from "@codemirror/lint";
import { Button } from "../../../ui";
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
import "./source.css";

const emptyIndex: TexIndex = { headings: [], labels: [], citations: [] };
export function SourcePanel(props: SourcePanelProps) {
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
  const otherIndex = useRef<TexIndex>(emptyIndex);
  const currentIndex = useMemo(() => texIndex(source), [source]);
  const completionIndex = useRef<TexIndex>(emptyIndex);
  completionIndex.current = {
    headings: currentIndex.headings,
    labels: [...new Set([...otherIndex.current.labels, ...currentIndex.labels])],
    citations: [...new Set([...otherIndex.current.citations, ...currentIndex.citations])],
  };
  const snapshot = useSyncExternalStore(props.document.subscribe, props.document.getSnapshot, props.document.getSnapshot);
  const checkEnabled = useSyncExternalStore(subscribeCodeCheck, getCodeCheckEnabled, getCodeCheckEnabled);
  const copy = sourceCatalog[language];
  const online = snapshot.persistence.kind === "saved" || snapshot.persistence.kind === "saving";
  useEffect(() => () => imageUpload.current?.abort(), [props.document]);
  useEffect(() => {
    const node = parent.current;
    if (!node) return undefined;
    const initial = props.document.source.toJSON();
    otherIndex.current = emptyIndex;
    completionIndex.current = texIndex(initial);
    setSource(initial);
    const created = createSourceEditor({
      parent: node, document: props.document, preferences: latest.current.preferences,
      index: () => completionIndex.current, selection: latest.current.selection,
      onChange: setSource, onFind: () => setTool("find"),
      onSelection: selection => latest.current.onSelectionChange(selection),
    });
    setEditor(created);
    latest.current.onHandle(created.handle);
    return () => { latest.current.onHandle(null); created.destroy(); };
  }, [props.document]);
  useEffect(() => { editor?.preferences(props.preferences); }, [editor, props.preferences]);
  useEffect(() => {
    if (!editor) return undefined;
    props.onToolsHandle?.({
      open: setTool,
      close: () => { setTool(null); editor.handle.focus(); },
      format: command => { editor.handle.focus(); return sourceCommand(editor.view, command); },
    });
    return () => props.onToolsHandle?.(null);
  }, [editor, props.onToolsHandle]);
  useEffect(() => { if (tool && tool !== "find") toolHeading.current?.focus(); }, [tool]);
  useEffect(() => {
    if (!editor) return;
    const selection = editor.view.state.selection.main;
    if (selection.anchor !== props.selection.anchor || selection.head !== props.selection.head) editor.handle.select(props.selection);
  }, [editor, props.selection]);
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
  return <section className="q-source-panel" aria-label={copy.source} lang={language} data-presentation={props.presentation ?? "standalone"} data-theme={props.preferences.theme} data-spelling-state={spelling.state.kind}>
    {props.presentation !== "embedded" && <><header className="q-source-toolbar">
      <strong className="q-source-filename" title={props.document.file.path}>{props.document.file.path}</strong>
      <div className="q-source-row">{(["find", "outline", "check", "preferences", "shortcuts"] as const).map(name =>
        <Button key={name} size="small" variant="ghost" aria-pressed={tool === name} onClick={() => setTool(tool === name ? null : name)}>{copy[name]}</Button>)}</div>
    </header>
    <div className="q-source-format q-source-row" aria-label="Source formatting">
      <Button size="small" disabled={!editor || snapshot.readOnly} title="Bold (Ctrl/Cmd+B)" onClick={() => editor && sourceCommand(editor.view, "bold")}>Bold</Button>
      <Button size="small" disabled={!editor || snapshot.readOnly} title="Italic (Ctrl/Cmd+I)" onClick={() => editor && sourceCommand(editor.view, "italic")}>Italic</Button>
      <Button size="small" disabled={!editor || snapshot.readOnly} onClick={() => editor && sourceCommand(editor.view, "inline-math")}>{copy.math}</Button>
      <Button size="small" disabled={!editor || snapshot.readOnly} onClick={() => editor && sourceCommand(editor.view, "display-math")}>{copy.displayMath}</Button>
    </div></>}
    {snapshot.readOnlyReason && <p className="q-source-notice" role="status">{snapshot.readOnlyReason}</p>}
    {tool !== "check" && tool !== "preferences" && <SpellingStatus state={spelling.state} compact />}
    <div ref={parent} className="q-source-editor" onPasteCapture={event => {
      if (!Array.from(event.clipboardData.items).some(item => item.kind === "file")) return;
      event.preventDefault(); event.stopPropagation();
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
      {tool === "find" && <SourceFind editor={editor} copy={copy} readOnly={snapshot.readOnly} />}
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
    {error && <p className="q-source-notice" role="alert">{error}</p>}
  </section>;
}
