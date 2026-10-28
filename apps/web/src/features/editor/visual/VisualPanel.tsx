import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../../ui";
import type { SourceEdit, VisualPanelProps } from "../shared";
import { applyVisualEdits, parseDocument, selectionEdit, sourceRevision } from "./commands";
import { VisualEditError } from "./model";
import { tsvTable } from "./structures";
import { prepareImagePaste, prepareProjectFigure } from "./upload";
import { clipboardImage, projectFigure } from "./media";
import { Nodes } from "./Nodes";
import "./visual.css";

export function VisualPanel(props: VisualPanelProps) {
  const { document, onHandle, selection, onSelectionChange } = props;
  const status = useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
  const subscribe = useMemo(() => (listener: () => void) => {
    document.source.observe(listener);
    return () => document.source.unobserve(listener);
  }, [document]);
  const revision = useSyncExternalStore(subscribe, () => sourceRevision(document));
  const parsed = useMemo(() => parseDocument(document), [document, revision]);
  const boundary = parsed.nodes.findIndex(node => node.command === "document boundary");
  const preamble = boundary < 0 ? [] : parsed.nodes.slice(0, boundary + 1);
  const preambleNodes = preamble.filter(node => node.kind !== "heading");
  const bodyNodes = boundary < 0 ? parsed.nodes : [
    ...preamble.filter(node => node.kind === "heading"), ...parsed.nodes.slice(boundary + 1),
  ];
  const root = useRef<HTMLElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = status.persistence.kind === "saved" || status.persistence.kind === "saving";
  const report = (failure: Error) => setError(failure.message);
  const apply = (edits: readonly SourceEdit[]) => {
    try { applyVisualEdits(document, parsed, edits); setError(null); }
    catch (failure) { if (!(failure instanceof Error)) throw failure; report(failure); }
  };
  const insert = (text: string) => {
    const edit = selectionEdit(selection, text);
    apply([edit]);
    onSelectionChange({ anchor: edit.from + text.length, head: edit.from + text.length });
  };
  useEffect(() => {
    const focusAt = (at: number, anchor = at) => {
      const fields = root.current?.querySelectorAll<HTMLTextAreaElement>("textarea[data-source-from]");
      const field = Array.from(fields ?? []).find(entry =>
        Number(entry.dataset["sourceFrom"]) <= at && Number(entry.dataset["sourceTo"]) >= at);
      if (!field) return;
      let parent = field.parentElement;
      while (parent && parent !== root.current) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      field.focus();
      const from = Number(field.dataset["sourceFrom"]);
      field.setSelectionRange(Math.max(0, Math.min(anchor, at) - from),
        Math.min(field.value.length, Math.max(anchor, at) - from), anchor > at ? "backward" : "forward");
      field.scrollIntoView({ block: "nearest" });
    };
    onHandle({
      focus: () => focusAt(selection.head, selection.anchor),
      select: next => { onSelectionChange(next); focusAt(next.head, next.anchor); },
      reveal: location => {
        if (location.fileId !== document.file.id) return;
        const lines = parsed.source.split("\n").slice(0, location.line - 1);
        focusAt(lines.reduce((sum, line) => sum + line.length + 1, 0) + location.column - 1);
      },
      replaceSelection: text => {
        try { applyVisualEdits(document, parsed, [selectionEdit(selection, text)]); }
        catch (failure) { if (!(failure instanceof Error)) throw failure; setError(failure.message); }
      },
    });
    return () => onHandle(null);
  }, [document, onHandle, parsed, selection, onSelectionChange]);
  useEffect(() => () => abort.current?.abort(), [document]);
  const wrap = (open: string, close = "}") => insert(open +
    parsed.source.slice(Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head)) + close);
  return <section className="q-visual" ref={root} aria-label="Visual editor" onPaste={event => {
    if (Array.from(event.clipboardData.items).some(item => item.kind === "file")) {
      event.preventDefault();
      if (status.readOnly || abort.current) return;
      let file: File | null;
      try { file = clipboardImage(event.clipboardData); }
      catch (failure) { if (!(failure instanceof Error)) throw failure; report(failure); return; }
      if (!file) return;
      if (!online) { report(new VisualEditError("OFFLINE", "Reconnect before uploading an image.")); return; }
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      void prepareImagePaste(props, file, selection, controller.signal).then(edits => {
        if (controller.signal.aborted) return;
        document.replace(edits);
        setError(null);
      }).catch((failure: unknown) => {
        if (!(failure instanceof Error)) throw failure;
        if (!controller.signal.aborted) report(failure);
      }).finally(() => {
        if (abort.current === controller) { setBusy(false); abort.current = null; }
      });
    } else {
      const text = event.clipboardData.getData("text/plain");
      if (text.includes("\t")) { event.preventDefault(); if (!status.readOnly) {
        try { insert(`\n${tsvTable(text)}\n`); }
        catch (failure) { if (!(failure instanceof Error)) throw failure; report(failure); }
      } }
    }
  }}>
    <div className="q-visual-toolbar" role="group" aria-label="Visual formatting">
      <h2>Visual</h2>
      <Button disabled={status.readOnly} onClick={() => wrap("\\textbf{")}>Bold</Button>
      <Button disabled={status.readOnly} onClick={() => wrap("\\emph{")}>Italic</Button>
      <Button disabled={status.readOnly} onClick={() => wrap("\\section{")}>Heading</Button>
      <Button disabled={status.readOnly} onClick={() => wrap("\\begin{itemize}\n\\item ", "\n\\end{itemize}")}>List</Button>
      <Button disabled={status.readOnly} onClick={() => wrap("$", "$")}>Math</Button>
      <Button disabled={status.readOnly} onClick={() => wrap("\\cite{")}>Citation</Button>
      <Button disabled={status.readOnly} onClick={() => wrap("\\ref{")}>Reference</Button>
      <Button disabled={status.readOnly} onClick={() => insert(`\n${tsvTable("Column 1\tColumn 2\nValue\tValue")}\n`)}>Table</Button>
      <label className="q-visual-image-picker">Figure
        <select className="q-input" aria-label="Insert project image" value="" disabled={status.readOnly || busy}
          onChange={event => {
            const path = event.currentTarget.value;
            if (!path) return;
            const controller = new AbortController();
            abort.current = controller;
            setBusy(true);
            void prepareProjectFigure(props, path, selection, controller.signal).then(edits => {
              if (!controller.signal.aborted) { document.replace(edits); setError(null); }
            }).catch((failure: unknown) => {
              if (!(failure instanceof Error)) throw failure;
              if (!controller.signal.aborted) report(failure);
            }).finally(() => {
              if (abort.current === controller) { setBusy(false); abort.current = null; }
            });
          }}>
          <option value="">Choose image…</option>
          {props.workspace.files.filter(projectFigure).map(file =>
            <option value={file.path} key={file.id}>{file.path}</option>)}
        </select>
      </label>
    </div>
    {status.readOnly && <p role="status">{status.readOnlyReason}</p>}
    {status.persistence.kind === "offline" && <p role="status">Offline: local edits are not yet saved.</p>}
    <p>Paste one PNG, JPEG, GIF, WebP or BMP. Clipboard images are stored as PNG; animated images use the first frame. SVG and multiple images are unsupported.</p>
    {busy && <p role="status">Preparing image (clipboard images convert to PNG)… <Button onClick={() => abort.current?.abort()}>Cancel image insertion</Button></p>}
    {error && <p role="alert" className="q-visual-error">{error}</p>}
    <div className="q-visual-body" tabIndex={0}>
      <div className="q-visual-document">
      {preambleNodes.length > 0 && <details className="q-visual-preamble">
        <summary>Document preamble</summary>
        {preambleNodes.map(node => <Nodes key={`${node.from}:${node.kind}`} editor={props}
          parsed={parsed} node={node} apply={apply} report={report} />)}
      </details>}
      {parsed.source ? bodyNodes.map(node => <Nodes key={`${node.from}:${node.kind}`} editor={props}
        parsed={parsed} node={node} apply={apply} report={report} />)
        : <div><p>This file is empty. Add a paragraph to begin.</p>
          <Button disabled={status.readOnly} onClick={() => insert("New paragraph\n")}>Add paragraph</Button></div>}
      </div>
    </div>
  </section>;
}
