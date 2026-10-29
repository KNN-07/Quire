import { endpoints } from "@quire/contracts";
import type { Diagnostic } from "@quire/contracts";
import { useState } from "react";
import type { CheckIssue } from "./check";
import type { SourcePanelProps } from "../shared";
import type { SourceEditor } from "./editor";
import type { SourceCopy } from "./locale";
import { Button } from "../../../ui";
import { sourceSelection } from "./tex";
import { editorValue } from "../shared";
import { getCodeCheckEnabled, setCodeCheckEnabled } from "./check-state";
import { SpellingStatus } from "./SpellingStatus";
import type { SpellingIssue, SpellingState } from "./spelling";

export function SourceDiagnostics({ props, editor, issues, copy, spelling }: {
  readonly props: SourcePanelProps;
  readonly editor: SourceEditor;
  readonly issues: readonly CheckIssue[];
  readonly copy: SourceCopy;
  readonly spelling: { readonly state: SpellingState; readonly issues: readonly SpellingIssue[] };
}) {
  const [navigationError, setNavigationError] = useState("");
  const [addingWord, setAddingWord] = useState(false);
  const persistence = props.document.getSnapshot().persistence;
  const online = persistence.kind === "saved" || persistence.kind === "saving";
  const compiler = (diagnostic: Diagnostic) => {
    if (!diagnostic.fileId || diagnostic.line === null) return;
    const location = { fileId: diagnostic.fileId, line: diagnostic.line, column: diagnostic.column ?? 1 };
    if (location.fileId === props.document.file.id) { editor.handle.reveal(location); return; }
    setNavigationError("");
    void props.navigation.revealSource(location).catch((cause: unknown) => {
      if (cause instanceof Error) setNavigationError(cause.message); else throw cause;
    });
  };
  return <div className="q-source-stack">
    <label className="q-source-row"><input type="checkbox" checked={getCodeCheckEnabled()} onChange={event => setCodeCheckEnabled(event.target.checked)} />{copy.enableCheck}</label>
    <p>Heuristic checks do not compile TeX. Suppression never hides compiler diagnostics.</p>
    <div className="q-source-row">
      <Button disabled={editor.view.state.readOnly} onClick={() => editor.view.dispatch({ changes: { from: 0, insert: "% quire-check disable-file all\n" }, userEvent: "input" })}>{copy.suppressFile}</Button>
      <Button disabled={editor.view.state.readOnly || editor.view.state.selection.main.empty} onClick={() => {
        const source = editor.view.state.doc.toString();
        const selection = sourceSelection(source, editor.view.state.selection.main);
        const from = Math.min(selection.anchor, selection.head);
        const to = Math.max(selection.anchor, selection.head);
        editor.view.dispatch({ changes: { from, to, insert: `\n% quire-check disable all\n${source.slice(from, to)}\n% quire-check enable all\n` }, userEvent: "input" });
      }}>{copy.suppressRegion}</Button>
    </div>
    {issues.length === 0 ? <p>{copy.noChecks}</p> : <ul className="q-source-list">{issues.map(issue =>
      <li key={`${issue.rule}:${issue.from}`}><Button variant="ghost" onClick={() => {
        editor.handle.select({ anchor: issue.from, head: issue.to }); editor.handle.focus();
      }}>Code Check: {issue.message}</Button></li>)}</ul>}
    <h3>Spelling</h3>
    <SpellingStatus state={spelling.state} />
    <ul className="q-source-list">{spelling.issues.map(issue => <li key={`spell:${issue.from}`} className="q-source-row">
      <Button variant="ghost" onClick={() => { editor.handle.select({ anchor: issue.from, head: issue.to }); editor.handle.focus(); }}>Spelling: {issue.word}</Button>
      <Button disabled={addingWord || props.workspace.access.actorId === null} size="small" aria-label={`Add ${issue.word} to dictionary`} onClick={() => {
        setAddingWord(true); setNavigationError("");
        void props.client.call(endpoints.preferencesPatch, { params: {}, query: {}, body: {
          expectedVersion: props.preferences.version, customWords: [...new Set([...props.preferences.customWords, issue.word.normalize("NFC")])],
        } }).then(result => props.onPreferencesChange(editorValue(result)))
          .catch((cause: unknown) => { if (cause instanceof Error) setNavigationError(cause.message); else throw cause; })
          .finally(() => setAddingWord(false));
      }}>Add word</Button>
    </li>)}</ul>
    <h3>{copy.compiler}</h3>
    {props.diagnostics.length === 0 ? <p>No compiler diagnostics supplied for this build.</p>
      : <ul className="q-source-list">{props.diagnostics.map(diagnostic => <li key={diagnostic.id}>
        {diagnostic.fileId && diagnostic.line !== null
          ? <Button variant="ghost" disabled={!online && diagnostic.fileId !== props.document.file.id} onClick={() => compiler(diagnostic)}>{diagnostic.severity}: {diagnostic.message} ({props.workspace.files.find(file => file.id === diagnostic.fileId)?.path ?? "Source"}:{diagnostic.line})</Button>
          : <p>{diagnostic.severity}: {diagnostic.message}</p>}
      </li>)}</ul>}
    {navigationError && <p role="alert">{navigationError}</p>}
  </div>;
}
