import { useEffect, useState } from "react";
import { z } from "zod";
import { endpoints, ProjectPathSchema } from "@quire/contracts";
import type { AdapterGrant } from "@quire/contracts";
import { editorValue } from "../shared";
import type { ToolsPanelProps } from "../shared";
import { Button, Field } from "../../../ui";
import { createToolsActions } from "./actions";
import { Feedback } from "./Feedback";
import { useTool } from "./use-tool";
import { MendeleyBibliographyPreview } from "./MendeleyBibliographyPreview";

const LibrariesSchema = z.object({
  personalUrl: z.url(),
  groups: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.string(), url: z.url() })),
});
type Libraries = z.infer<typeof LibrariesSchema>;

export function MendeleyBibliography(props: ToolsPanelProps) {
  const state = useTool(props);
  const [grants, setGrants] = useState<readonly AdapterGrant[]>([]);
  const [account, setAccount] = useState("");
  const [libraries, setLibraries] = useState<Libraries | null>(null);
  const [selection, setSelection] = useState("");
  const [path, setPath] = useState("mendeley.bib");
  const grant = grants.find(item => item.id === account) ?? (grants.length === 1 ? grants[0] : undefined);
  const owner = props.workspace.access.effectiveRole === "owner";
  useEffect(() => {
    const controller = new AbortController();
    void state.run(async () => {
      try {
        const result = editorValue(await props.client.call(endpoints.connectionsList,
          { params: {}, query: {}, body: undefined }, controller.signal));
        if (!controller.signal.aborted) setGrants(result.items.filter(item => item.provider === "mendeley" && item.state === "ready"));
      } catch (error) { if (!controller.signal.aborted) throw error; }
    });
    return () => controller.abort();
  }, [props.client, state.run]);
  return <section aria-label="Mendeley bibliography" className="editor-tools__stack">
    <h3>Mendeley bibliography</h3>
    <p>Link your personal library or an authorized group as a read-only .bib file. Refresh keeps the original
      library selection. Individual Copy and Cite results below remain separate, editable project records.</p>
    {!owner && <p>Only the project Owner can link or refresh a bulk bibliography.</p>}
    {!grants.length && <p>Connect a Mendeley account in Account connections first.</p>}
    <label>Mendeley account<select aria-label="Mendeley account" value={grant?.id ?? ""}
      disabled={state.busy} onChange={event => {
        setAccount(event.target.value); setLibraries(null); setSelection("");
      }}>
      <option value="">Choose an account</option>
      {grants.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    <Button disabled={!grant || state.busy || !!state.blocked} onClick={() => void state.run(async () => {
      if (!grant) return;
      setLibraries(null); setSelection("");
      const operation = editorValue(await props.client.call(endpoints.connectionAction, {
        params: { id: grant.id }, query: {}, headers: { "idempotency-key": crypto.randomUUID() },
        body: { action: "groups", projectId: props.workspace.scope.projectId,
          parameters: {}, expectedVersion: grant.version, expectedCursor: null },
      }));
      if (operation.status !== "succeeded") throw new Error(`Mendeley libraries: ${operation.errorCode ?? operation.status}`);
      const loaded = LibrariesSchema.parse(operation.result);
      setLibraries(loaded); setSelection(loaded.personalUrl);
    })}>Load Mendeley libraries</Button>
    {libraries && <>
      <label>Mendeley library<select aria-label="Mendeley library" value={selection} disabled={state.busy}
        onChange={event => setSelection(event.target.value)}>
        <option value={libraries.personalUrl}>Personal library</option>
        {libraries.groups.map(group => <option key={group.id} value={group.url}>Group: {group.name}</option>)}
      </select></label>
      {!libraries.groups.length && <p>This account returned no authorized groups.</p>}
      <Field label="Mendeley bibliography path" value={path} required onChange={event => setPath(event.target.value)} />
      <Button disabled={!owner || state.busy || !!state.blocked || !selection || !/\.bib$/i.test(path)}
        onClick={() => void state.run(async () => {
          if (!grant) return;
          const expectedVersion = await createToolsActions(props).ready(true);
          const file = editorValue(await props.client.call(endpoints.linkCreate, {
            params: { p: props.workspace.scope.projectId }, query: {},
            headers: { ...props.workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
            body: { scope: props.workspace.scope, kind: "bibliography", path: ProjectPathSchema.parse(path),
              url: selection, grantId: grant.id, expectedVersion },
          }));
          await props.refreshWorkspace();
          state.setMessage(`Linked ${file.path} as read only.`);
        })}>Link Mendeley bibliography</Button>
    </>}
    <ul className="editor-tools__results">{props.workspace.files.filter(file => file.link?.kind === "bibliography").map(file =>
      <li key={file.id}><span>{file.path} (linked, read only)</span>
        <div className="editor-tools__cluster">
          <MendeleyBibliographyPreview {...props} key={`${file.id}:${file.blob}`} file={file} label={`Open ${file.path}`} />
          <Button disabled={!owner || state.busy || !!state.blocked} onClick={() => void state.run(async () => {
            await createToolsActions(props).refreshLink(file);
            state.setMessage(`Refreshed ${file.path} from its original library.`);
          })}>Refresh {file.path}</Button>
        </div>
      </li>)}</ul>
    <Feedback state={state} />
  </section>;
}
