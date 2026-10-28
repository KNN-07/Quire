import { useEffect, useState } from "react";
import { findNext, findPrevious, replaceAll, replaceNext, setSearchQuery } from "@codemirror/search";
import { Button, Field } from "../../../ui";
import type { SourceEditor } from "./editor";
import { selectionScope, setSearchScope, sourceQuery } from "./search";
import type { SourceCopy } from "./locale";

export function SourceFind({ editor, copy, readOnly }: {
  readonly editor: SourceEditor;
  readonly copy: SourceCopy;
  readonly readOnly: boolean;
}) {
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCase] = useState(false);
  const [regexp, setRegex] = useState(false);
  const [wholeWord, setWord] = useState(false);
  const [scoped, setScoped] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const query = sourceQuery({ search, replace, caseSensitive, regexp, wholeWord });
    editor.view.dispatch({ effects: setSearchQuery.of(query) });
  }, [editor, search, replace, caseSensitive, regexp, wholeWord]);
  useEffect(() => () => {
    editor.view.dispatch({ effects: [setSearchScope.of(null), setSearchQuery.of(sourceQuery({ search: "", replace: "", caseSensitive: false, regexp: false, wholeWord: false }))] });
  }, [editor]);
  const query = sourceQuery({ search, replace, caseSensitive, regexp, wholeWord });
  let matches = 0;
  if (query.valid) {
    const cursor = query.getCursor(editor.view.state);
    while (!cursor.next().done) matches++;
  }
  return <form className="q-source-stack" onSubmit={event => { event.preventDefault(); findNext(editor.view); }}>
    <Field label={copy.search} value={search} onChange={event => setSearch(event.target.value)} autoFocus />
    <Field label={copy.replacement} value={replace} onChange={event => setReplace(event.target.value)} />
    <div className="q-source-options">
      <label><input type="checkbox" checked={caseSensitive} onChange={event => setCase(event.target.checked)} />{copy.matchCase}</label>
      <label><input type="checkbox" checked={wholeWord} onChange={event => setWord(event.target.checked)} />{copy.wholeWord}</label>
      <label><input type="checkbox" checked={regexp} onChange={event => setRegex(event.target.checked)} />{copy.regex}</label>
      <label><input type="checkbox" checked={scoped} onChange={event => {
        const selection = editor.view.state.selection.main;
        setScoped(event.target.checked);
        editor.view.dispatch({ effects: setSearchScope.of(event.target.checked ? selectionScope(selection.anchor, selection.head) : null) });
      }} />{copy.selection}</label>
    </div>
    {search && !query.valid && <p role="alert">Invalid regular expression. Correct the pattern before searching.</p>}
    <div className="q-source-row">
      <Button disabled={!matches} onClick={() => findPrevious(editor.view)}>{copy.previous}</Button>
      <Button disabled={!matches} type="submit">{copy.next}</Button>
      <Button disabled={!matches || readOnly} onClick={() => replaceNext(editor.view)}>{copy.replace}</Button>
      <Button disabled={!matches || readOnly} onClick={() => {
        const cursor = query.getCursor(editor.view.state);
        let replacements = 0;
        while (!cursor.next().done) replacements++;
        replaceAll(editor.view);
        setMessage(`${replacements} replacements`);
      }}>{copy.replaceAll}</Button>
    </div>
    {search && <p role="status">{matches} matches in current file</p>}
    <p role="status">{message}</p>
  </form>;
}
