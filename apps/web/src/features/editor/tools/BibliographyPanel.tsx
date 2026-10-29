import { useEffect, useState } from "react";
import { endpoints, IdSchema } from "@quire/contracts";
import type { FileEntry } from "@quire/contracts";
import { editorValue } from "../shared";
import type { ToolsPanelProps } from "../shared";
import { Button } from "../../../ui";
import { Feedback } from "./Feedback";
import { bibliographyKeys, insertCommand } from "./insertion";
import { LibraryPanel } from "./LibraryPanel";
import { useTool } from "./use-tool";
import { matchesReference, referenceMetadata } from "./library-metadata";
import type { ReferenceFilter } from "./library-metadata";
import { ReferenceSearch } from "./ReferenceSearch";
import { RemoteReferencePanel } from "./RemoteReferencePanel";
import { MendeleyBibliography } from "./MendeleyBibliography";
import { MendeleyBibliographyPreview } from "./MendeleyBibliographyPreview";

type Entry = { readonly file: FileEntry; readonly key: string; readonly offset: number; readonly fields: Readonly<Record<string, string>> };
export function BibliographyPanel(props: ToolsPanelProps) {
  const state = useTool(props);
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReferenceFilter>("all");
  const [target, setTarget] = useState("");
  const candidates = props.workspace.files.filter(file => file.path.toLowerCase().endsWith(".bib") && file.kind === "file");
  const editable = candidates.filter(file => file.editable && !file.link);
  const selectedTarget = editable.find(file => file.id === target)?.id ?? (editable.length === 1 ? editable[0]?.id ?? "" : "");
  const creationBlocked = editable.length === 0 && props.workspace.files.some(file => file.path === "references.bib");
  const { client, workspace } = props;
  useEffect(() => {
    const abort = new AbortController();
    void state.run(async () => {
      try {
        const loaded = await Promise.all(workspace.files.filter(file => file.path.toLowerCase().endsWith(".bib") && file.kind === "file").map(async file => {
          const request = { params: { p: workspace.scope.projectId, f: file.id }, query: { branch: workspace.scope.branch },
            headers: workspace.requestHeaders, body: undefined };
          const text = file.editable ?
            editorValue(await client.call(endpoints.fileDocument, request, abort.signal)).text :
            new TextDecoder("utf-8", { fatal: true }).decode(editorValue(await client.call(endpoints.fileContent, request, abort.signal)));
          return bibliographyKeys(text).map(entry => ({ ...entry, file, fields: referenceMetadata(text.slice(entry.offset)) }));
        }));
        if (!abort.signal.aborted) setEntries(loaded.flat());
      } catch (caught) {
        if (!abort.signal.aborted) throw caught;
      }
    });
    return () => abort.abort();
  }, [client, workspace, state.run]);
  return <section aria-label="Bibliography">
    <h2>Bibliography</h2>
    <ReferenceSearch label="Find citation key" query={query} filter={filter} onQuery={setQuery} onFilter={setFilter} />
    <p>Project records: key, author, title, journal, year and date. Searches literal fields, not expanded TeX or string macros.</p>
    <ul className="editor-tools__results">{entries.filter(entry => matchesReference(entry.key, entry.fields, query, filter)).map(entry =>
      <li key={`${entry.file.id}-${entry.offset}`}>
        <code>{entry.key}</code><span>{entry.file.path}{entry.file.link ? " (linked, read only)" : ""}</span>
        {entry.fields["title"] && <span>{entry.fields["title"]}</span>}
        <div className="editor-tools__cluster">
          <Button disabled={!state.canWrite || !props.authoring || props.document?.getSnapshot().readOnly}
            onClick={() => void state.run(async () => {
              await insertCommand(props, { command: `\\cite{${entry.key}}` });
              state.setMessage(`Inserted citation ${entry.key}.`);
            })}>Insert citation</Button>
          {entry.file.link ? <MendeleyBibliographyPreview {...props} key={`${entry.file.id}:${entry.file.blob}`}
            file={entry.file} label="Open bibliography" /> : <Button disabled={!!state.blocked || state.busy} onClick={() => void state.run(async () => {
            await props.document?.flush();
            await props.navigation.openFile(entry.file.id);
          })}>Open bibliography</Button>}
        </div>
      </li>)}</ul>
    {!state.busy && entries.length === 0 && <p>No citation keys yet. Add a local Library record below or open a .bib file to edit it.</p>}
    <label>Copy entries into
      <select aria-label="Bibliography target" value={selectedTarget} onChange={event => setTarget(event.target.value)}>
        <option value="">{creationBlocked ? "Create an editable .bib file in Files" : editable.length === 0 ? "Create references.bib" : "Choose an editable bibliography"}</option>
        {editable.map(file => <option key={file.id} value={file.id}>{file.path}</option>)}
      </select>
    </label>
    {editable.length > 1 && !selectedTarget && <p>Several editable bibliographies exist. Choose a target before copying.</p>}
    {creationBlocked && <p>references.bib is not an editable bibliography. Create a new .bib file in Files before copying Library entries.</p>}
    <Feedback state={state} />
    <MendeleyBibliography {...props} key={`mendeley:${workspace.scope.projectId}:${workspace.scope.branch}`} />
    <RemoteReferencePanel {...props} key={`${workspace.scope.projectId}:${workspace.scope.branch}`}
      target={selectedTarget ? IdSchema.parse(selectedTarget) : null}
      targetRequired={creationBlocked || (editable.length > 1 && !selectedTarget)} />
    <LibraryPanel {...props} target={selectedTarget ? IdSchema.parse(selectedTarget) : null}
      targetRequired={creationBlocked || (editable.length > 1 && !selectedTarget)} />
  </section>;
}
