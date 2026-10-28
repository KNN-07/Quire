import { useState } from "react";
import type { ResponseOf, endpoints } from "@quire/contracts";
import type { ToolsPanelProps } from "../shared";
import { Button, Field } from "../../../ui";
import { createToolsActions } from "./actions";
import { Feedback } from "./Feedback";
import { useTool } from "./use-tool";

export function SearchPanel(props: ToolsPanelProps) {
  const state = useTool(props);
  const [q, setQuery] = useState("");
  const [matchCase, setCase] = useState(false);
  const [word, setWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<ResponseOf<typeof endpoints.projectSearch> | null>(null);
  const filename = (id: string) => props.workspace.files.find(file => file.id === id)?.path ?? "Unavailable file";
  return <section aria-label="Project search">
    <h2>Project search</h2>
    <form className="editor-tools__stack" onSubmit={event => {
      event.preventDefault();
      void state.run(async () => setResults(await createToolsActions(props).search({ q, matchCase, word, regex })));
    }}>
      <Field label="Find in project source" placeholder="Search source files" value={q} required onChange={event => setQuery(event.target.value)} />
      <div className="editor-tools__cluster">
        <label><input type="checkbox" checked={matchCase} onChange={event => setCase(event.target.checked)} /> Match case</label>
        <label><input type="checkbox" checked={word} onChange={event => setWord(event.target.checked)} /> Whole word</label>
        <label><input type="checkbox" checked={regex} onChange={event => setRegex(event.target.checked)} /> Regular expression</label>
      </div>
      <Button type="submit" variant="primary" disabled={state.busy || !!state.blocked}>Search</Button>
    </form>
    <Feedback state={state} />
    {results && <>
      <p role="status">{results.matches.length} source matches. PDF content is not searched.</p>
      <ol className="editor-tools__results">{results.matches.map((match, index) => <li key={`${match.fileId}-${match.line}-${match.column}-${index}`}>
        <Button variant="ghost" disabled={state.busy || !!state.blocked} onClick={() => void state.run(async () => {
          await props.document?.flush();
          await props.navigation.revealSource(match);
        })}><span>{filename(match.fileId)}:{match.line}:{match.column}</span><code>{match.preview}</code></Button>
      </li>)}</ol>
      {results.matches.length === 0 && <p>No source matches. Change the query or search options.</p>}
      {results.excluded.length > 0 && <details open><summary>Excluded files ({results.excluded.length})</summary>
        <ul>{results.excluded.map(file => <li key={file.fileId}>{filename(file.fileId)}: {file.reason}</li>)}</ul>
      </details>}
    </>}
  </section>;
}
