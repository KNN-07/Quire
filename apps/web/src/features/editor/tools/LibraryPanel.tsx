import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Id, LibraryEntry } from "@quire/contracts";
import { editorValue } from "../shared";
import type { ToolsPanelProps } from "../shared";
import { Button, Field, Modal } from "../../../ui";
import { createToolsActions } from "./actions";
import { Feedback } from "./Feedback";
import { useTool } from "./use-tool";
import { insertCommand } from "./insertion";
import { manualReference, matchesReference, referenceFields, referenceMetadata } from "./library-metadata";
import type { ReferenceFilter } from "./library-metadata";
import { ReferenceSearch } from "./ReferenceSearch";
import "./library.css";

type Props = ToolsPanelProps & { readonly target: Id | null; readonly targetRequired: boolean };
export function LibraryPanel(props: Props) {
  const state = useTool(props);
  const [entries, setEntries] = useState<readonly LibraryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<LibraryEntry | "new" | "import" | null>(null);
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null);
  const [bibtex, setBibtex] = useState("");
  const [key, setKey] = useState("");
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const [kind, setKind] = useState("article");
  const [doi, setDoi] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReferenceFilter>("all");
  const [format, setFormat] = useState("code");
  const { client } = props;
  useEffect(() => {
    const abort = new AbortController();
    void state.run(async () => {
      const page = editorValue(await client.call(endpoints.libraryList, {
        params: {}, query: {}, body: undefined,
      }, abort.signal));
      if (!abort.signal.aborted) { setEntries(page.items); setCursor(page.nextCursor); }
    });
    return () => abort.abort();
  }, [client, state.run]);
  const save = () => state.run(async () => {
    const source = format === "code" ? bibtex : manualReference(kind, key, fields);
    if (editing === "import") {
      const form = new FormData(); form.set("file", new File([source], "references.bib", { type: "text/plain" }));
      const imported = editorValue(await client.call(endpoints.libraryImport, {
        params: {}, query: {}, headers: { "idempotency-key": crypto.randomUUID() }, body: form,
      }));
      setEntries(previous => [...previous, ...imported]); setEditing(null);
      state.setMessage(`Imported ${imported.length} Library records.`);
      return;
    }
    const entry = typeof editing === "object" && editing !== null ?
      editorValue(await client.call(endpoints.libraryPatch, { params: { id: editing.id }, query: {},
        body: { bibtex: source, expectedVersion: editing.version } })) :
      editorValue(await client.call(endpoints.libraryCreate, { params: {}, query: {},
        headers: { "idempotency-key": crypto.randomUUID() }, body: { bibtex: source, origin: "manual" } }));
    setEntries(previous => [...previous.filter(item => item.id !== entry.id), entry]);
    setEditing(null);
    state.setMessage("Library record saved. Project copies are independent.");
  });
  const copy = (entry: LibraryEntry, insert: boolean) => state.run(async () => {
    const file = await createToolsActions({ ...props, refreshWorkspace: async () => {
      // A structural bibliography refresh can reopen the source editor. Insert and
      // durably save through its current handle before that refresh loses selection.
      if (insert) {
        await insertCommand(props, { command: `\\cite{${entry.citationKey}}` });
        await props.document?.flush();
      }
      await props.refreshWorkspace();
    } }).citation(entry.publication ?? {
      provider: "local", providerId: entry.id, title: entry.citationKey, authors: [], year: null,
      doi: null, url: null, bibtex: entry.bibtex,
    }, props.target ?? undefined);
    state.setMessage(`${insert ? "Inserted citation" : "Copied"} ${entry.citationKey} ${insert ? "with a copy in" : "to"} ${file.path}.`);
  });
  return <section aria-label="Local Library">
    <h3>Local Library</h3>
    <p>Copies are editable project files, independent of your Library. External reference adapters are configured separately.</p>
    <Button disabled={state.busy || !props.workspace.access.actorId} onClick={() => {
      setBibtex(""); setKey(""); setFields({}); setKind("article"); setFormat("code"); setEditing("new");
    }}>Add Library record</Button>
    <form className="editor-tools__stack" onSubmit={event => {
      event.preventDefault();
      void state.run(async () => {
        const entry = editorValue(await client.call(endpoints.libraryDoi, {
          params: {}, query: {}, headers: { "idempotency-key": crypto.randomUUID() }, body: { doi },
        }));
        setEntries(previous => [...previous.filter(item => item.id !== entry.id), entry]);
        setDoi(""); state.setMessage(`DOI record ${entry.citationKey} added to Library.`);
      });
    }}>
      <Field label="DOI lookup" required placeholder="10.1234/example or https://doi.org/..." value={doi}
        onChange={event => setDoi(event.target.value)} />
      <Button type="submit" disabled={state.busy || !props.workspace.access.actorId}>Look up DOI</Button>
      <p>Uses the operator-configured DOI adapter. Missing or disabled providers report an error.</p>
    </form>
    <label>Import .bib into Library<input aria-label="Import bibliography" type="file" accept=".bib" disabled={state.busy || !props.workspace.access.actorId}
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void state.run(async () => {
          if (!file.name.toLowerCase().endsWith(".bib")) throw new TypeError("Upload a .bib file.");
          if (file.size > 2 * 1024 * 1024) throw new TypeError("Bibliography exceeds 2 MiB.");
          setBibtex(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
          setFormat("code"); setEditing("import");
        });
      }} /></label>
    <ReferenceSearch label="Find Library records" query={query} filter={filter} onQuery={setQuery} onFilter={setFilter} />
    <p>Searches loaded records and literal BibTeX/BibLaTeX fields; macros are not expanded. Provider fields vary.</p>
    <ul className="editor-tools__results">{entries.filter(entry => matchesReference(entry.citationKey, referenceMetadata(entry.bibtex), query, filter)).map(entry => <li key={entry.id}>
      <code>{entry.citationKey}</code><pre>{entry.bibtex}</pre>
      <div className="editor-tools__cluster">
        <Button disabled={!state.canWrite || props.targetRequired} onClick={() => void copy(entry, false)}>Copy to project</Button>
        <Button disabled={!state.canWrite || props.targetRequired || !props.authoring || !props.document || props.document.getSnapshot().readOnly}
          onClick={() => void copy(entry, true)}>Cite in project</Button>
        <Button disabled={state.busy || entry.readonly} onClick={() => {
          setEditing(entry); setBibtex(entry.bibtex); setFormat("code");
        }}>Edit record</Button>
        <Button variant="danger" disabled={state.busy || entry.readonly} onClick={() => setDeleting(entry)}>Delete record</Button>
      </div>
      {entry.readonly && <p>Provider-linked record; edit or refresh it at its source.</p>}
    </li>)}</ul>
    {!state.busy && entries.length === 0 && <p>No Library records. Add a record or import a .bib file.</p>}
    {cursor && <Button disabled={state.busy} onClick={() => void state.run(async () => {
      const page = editorValue(await client.call(endpoints.libraryList, { params: {}, query: { cursor }, body: undefined }));
      setEntries(previous => [...previous, ...page.items]); setCursor(page.nextCursor);
    })}>Load more records</Button>}
    {editing === null && deleting === null && <Feedback state={state} />}
    <Modal open={editing !== null} title={editing === "new" ? "Add Library record" : editing === "import" ? "Review .bib import" : "Edit Library record"} onClose={() => { if (!state.busy) setEditing(null); }}>
      <form className="editor-tools__stack library-entry" onSubmit={event => { event.preventDefault(); void save(); }}>
        {editing === "new" && <label>Entry method<select aria-label="Entry method" value={format} onChange={event => {
          if (format === "fields" && event.target.value === "code") setBibtex(manualReference(kind, key, fields));
          setFormat(event.target.value);
        }}>
          <option value="code">BibTeX / BibLaTeX code</option><option value="fields">BibTeX / BibLaTeX fields</option>
        </select></label>}
        {format === "code" ? <label>BibTeX<textarea aria-label="BibTeX" value={bibtex} required onChange={event => setBibtex(event.target.value)} /></label> : <>
          <Field label="Citation key" required pattern="[a-zA-Z0-9_:./+\\-]+" value={key} onChange={event => setKey(event.target.value)} />
          <label>Entry type<select aria-label="Entry type" value={kind} onChange={event => setKind(event.target.value)}>
            {["article", "book", "inproceedings", "incollection", "proceedings", "phdthesis", "mastersthesis", "techreport", "online", "report", "thesis", "misc"].map(type => <option key={type}>{type}</option>)}
          </select></label>
          <p>Plain-text fields are escaped as LaTeX. Use code for macros, custom types or additional fields. Author/editor names use "and" separators.</p>
          <div className="library-entry__fields">{referenceFields.filter(([name]) => ["title", "author", "journal", "year", "date"].includes(name)).map(([name, label]) =>
            <Field key={name} label={label} required={name === "title"} value={fields[name] ?? ""}
              onChange={event => setFields(previous => ({ ...previous, [name]: event.target.value }))} />)}</div>
          <details><summary>More bibliographic fields</summary>
            <div className="library-entry__fields">{referenceFields.filter(([name]) => !["title", "author", "journal", "year", "date"].includes(name)).map(([name, label]) =>
              <Field key={name} label={label} value={fields[name] ?? ""}
                onChange={event => setFields(previous => ({ ...previous, [name]: event.target.value }))} />)}</div>
          </details>
          <Button onClick={() => { setBibtex(manualReference(kind, key, fields)); setFormat("code"); }}>Edit generated BibTeX</Button>
        </>}
        <Feedback state={state} />
        <div className="editor-tools__cluster"><Button disabled={state.busy} onClick={() => setEditing(null)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={state.busy}>Save record</Button></div>
      </form>
    </Modal>
    <Modal open={deleting !== null} title="Delete Library record" onClose={() => { if (!state.busy) setDeleting(null); }}>
      <p>Delete {deleting?.citationKey} from your Library? Project copies will remain.</p>
      <Feedback state={state} />
      <div className="editor-tools__cluster"><Button disabled={state.busy} onClick={() => setDeleting(null)}>Cancel</Button>
        <Button variant="danger" disabled={state.busy} onClick={() => void state.run(async () => {
          if (!deleting) return;
          editorValue(await client.call(endpoints.libraryDelete, { params: { id: deleting.id }, query: {},
            body: { expectedVersion: deleting.version } }));
          setEntries(previous => previous.filter(entry => entry.id !== deleting.id)); setDeleting(null);
        })}>Delete record permanently</Button></div>
    </Modal>
  </section>;
}
