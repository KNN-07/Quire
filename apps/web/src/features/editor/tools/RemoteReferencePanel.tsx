import { useEffect, useRef, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Id, Publication } from "@quire/contracts";
import { editorValue } from "../shared";
import type { ToolsPanelProps } from "../shared";
import { Button, Field } from "../../../ui";
import { createToolsActions } from "./actions";
import { bibliographyKeys, insertCommand } from "./insertion";
import { referenceMetadata } from "./library-metadata";
import { Feedback } from "./Feedback";
import { useTool } from "./use-tool";

type Props = ToolsPanelProps & { readonly target: Id | null; readonly targetRequired: boolean };
const providers = [
  ["crossref", "Crossref"], ["arxiv", "arXiv"], ["semanticScholar", "Semantic Scholar"], ["mendeley", "Mendeley"],
] as const;

/** Search is deliberate; changing the context cancels and invalidates every prior result. */
export function RemoteReferencePanel(props: Props) {
  const state = useTool(props);
  const [provider, setProvider] = useState("crossref");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly Publication[]>([]);
  const [selected, setSelected] = useState<Publication | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<{ controller: AbortController; generation: number } | null>(null);
  const generation = useRef(0);
  const invalidate = () => {
    generation.current++;
    active.current?.controller.abort();
    active.current = null;
    setSearching(false); setSearched(false); setError("");
    setItems([]); setSelected(null); setCursor(null);
  };
  useEffect(() => () => {
    generation.current++;
    active.current?.controller.abort();
  }, [props.client, props.workspace.scope.projectId, props.workspace.scope.branch]);
  const search = async (next?: string) => {
    active.current?.controller.abort();
    const controller = new AbortController();
    const current = ++generation.current;
    active.current = { controller, generation: current };
    setSearching(true); setError(""); setSelected(null);
    if (!next) { setItems([]); setCursor(null); }
    try {
      const page = editorValue(await props.client.call(endpoints.referencesSearch, {
        params: {}, query: { projectId: props.workspace.scope.projectId, provider, query: query.trim(),
          fields: "title,authors,year,doi,url", limit: 20, ...(next ? { cursor: next } : {}) },
        body: undefined,
      }, controller.signal));
      if (controller.signal.aborted || current !== generation.current) return;
      setItems(previous => next ? [...previous, ...page.items.filter(item =>
        !previous.some(existing => existing.provider === item.provider && existing.providerId === item.providerId))] : page.items);
      setCursor(page.nextCursor); setSearched(true);
    } catch (caught) {
      if (controller.signal.aborted || current !== generation.current) return;
      if (!(caught instanceof Error)) throw caught;
      setError(caught.message);
    } finally {
      if (current === generation.current) { setSearching(false); active.current = null; }
    }
  };
  const keys = selected ? bibliographyKeys(selected.bibtex) : [];
  const citationKey = keys.length === 1 ? keys[0]?.key : undefined;
  const copy = (insert: boolean) => state.run(async () => {
    if (!selected || !citationKey) throw new TypeError("Choose a result with one valid BibTeX citation key.");
    const publication = selected;
    const file = await createToolsActions({ ...props, refreshWorkspace: async () => {
      // Match LibraryPanel: retain the source selection until insertion has been saved.
      if (insert) {
        await insertCommand(props, { command: `\\cite{${citationKey}}` });
        await props.document?.flush();
      }
      await props.refreshWorkspace();
    } }).citation(publication, props.target ?? undefined);
    state.setMessage(`${insert ? "Inserted citation" : "Copied"} ${citationKey} ${insert ? "with a copy in" : "to"} ${file.path}.`);
  });
  return <section aria-label="Remote references" className="editor-tools__stack">
    <h3>Remote references</h3>
    <p>Search sends only the query and selected provider through this project's authorized reference service.
      No document text is sent. Results depend on operator configuration; Mendeley also requires an account grant.</p>
    <form className="editor-tools__stack" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label>Reference provider<select aria-label="Reference provider" value={provider} disabled={state.busy}
        onChange={event => { invalidate(); setProvider(event.target.value); }}>
        {providers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        <option disabled value="dimensions">Dimensions: unavailable (licensed contract not implemented)</option>
      </select></label>
      <Field label="Remote reference query" required maxLength={2000} value={query} disabled={state.busy}
        onChange={event => { invalidate(); setQuery(event.target.value); }} />
      <Button type="submit" disabled={state.busy || searching || !query.trim() || !!state.blocked}>Search provider</Button>
      {searching && <Button onClick={invalidate}>Cancel search</Button>}
    </form>
    {searching && <p role="status">Searching provider…</p>}
    {error && <p role="alert">{error}</p>}
    {searched && items.length === 0 && <p>No remote references found.</p>}
    <ul className="editor-tools__results">{items.map(item => {
      const fields = referenceMetadata(item.bibtex);
      return <li key={`${item.provider}:${item.providerId}`}>
        <label><input type="radio" name="remote-reference" disabled={state.busy || searching}
          checked={selected === item} onChange={() => setSelected(item)} />{item.title}</label>
        <span>{item.authors.length ? item.authors.join("; ") : "Authors not supplied"} · {item.year ?? "Year not supplied"}</span>
        {fields["journal"] && <span>{fields["journal"]}</span>}
        {fields["date"] && <span>{fields["date"]}</span>}
        <span>Source: {item.provider} · {item.providerId}</span>
        {item.doi && <span>DOI: {item.doi}</span>}
        {item.url && <span>{item.url}</span>}
      </li>;
    })}</ul>
    {cursor && <Button disabled={state.busy || searching} onClick={() => void search(cursor)}>Load more references</Button>}
    {selected && <details><summary>Selected BibTeX{citationKey ? `: ${citationKey}` : ""}</summary><pre>{selected.bibtex}</pre></details>}
    {selected && !citationKey && <p role="alert">Result must contain one valid BibTeX citation key before copying.</p>}
    <div className="editor-tools__cluster">
      <Button disabled={!state.canWrite || searching || props.targetRequired || !citationKey}
        onClick={() => void copy(false)}>Copy remote to project</Button>
      <Button disabled={!state.canWrite || searching || props.targetRequired || !citationKey || !props.authoring
        || !props.document || props.document.getSnapshot().readOnly}
        onClick={() => void copy(true)}>Cite remote in project</Button>
    </div>
    <Feedback state={state} />
  </section>;
}
