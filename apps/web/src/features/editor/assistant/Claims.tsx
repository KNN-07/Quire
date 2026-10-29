import { useRef, useState } from "react";
import { endpoints, IdSchema } from "@quire/contracts";
import type { AiClaimFinding } from "@quire/contracts";
import { Button } from "../../../ui";
import { editorValue } from "../shared";
import type { EditorClient } from "../shared";
import { createToolsActions } from "../tools/actions";
import { bibliographyKeys, insertCommand } from "../tools/insertion";
import { currentClaim } from "./claim-context";
import type { AssistantState } from "./use-assistant";

export function AssistantClaims({ state }: { readonly state: AssistantState }) {
  const [publicationId, setPublicationId] = useState("");
  const [targetId, setTargetId] = useState("");
  const latest = useRef(state);
  latest.current = state;
  const run = state.run;
  if (!run || run.tool !== "citation-reviewer") return null;
  const runId = run.id;
  const targets = state.workspace.files.filter(file => file.kind === "file" && file.editable && !file.link && /\.bib$/iu.test(file.path));
  const selected = run.sources.find(source => `${source.provider}:${source.providerId}` === publicationId);
  const keys = selected ? bibliographyKeys(selected.bibtex) : [];
  const key = keys.length === 1 ? keys[0]?.key : undefined;
  const target = targets.find(file => file.id === targetId);
  const disabled = state.busy || !state.online || state.tracking || !run.findingsCurrent || state.security?.confidential
    || !state.workspace.access.capabilities.edit || state.document?.getSnapshot().readOnly;
  const eligible = () => {
    if (latest.current !== state || state.signal.aborted || state.tracking || !state.workspace.access.capabilities.edit
      || state.security?.confidential || !run.findings.some(finding => currentClaim(finding, state.document))) {
      throw new TypeError("Review context is stale or unavailable. Reopen the reviewed source and request a current assessment.");
    }
  };
  async function highlight(finding: AiClaimFinding) {
    const epoch = state.authorityEpoch;
    const checked = editorValue(await state.client.call(endpoints.aiRunGet, { params: { id: runId }, query: {}, body: undefined, headers: state.headers }, state.signal));
    if (!checked.findingsCurrent || epoch !== state.authorityEpoch || latest.current.document !== state.document || latest.current.run?.id !== runId
      || latest.current.tracking || latest.current.authoring !== state.authoring
      || !currentClaim(finding, state.document) || !state.authoring) {
      throw new TypeError("Claim source changed. Open the reviewed file or request a new assessment; no text was highlighted.");
    }
    state.authoring.select({ anchor: finding.from, head: finding.to });
    state.authoring.focus();
    state.setNotice(`Highlighted exact UTF-16 range ${finding.from}–${finding.to} in ${finding.path}.`);
  }
  async function copy(cite: boolean) {
    eligible();
    if (!selected || !key || !target || !state.document || !state.citationClient) throw new TypeError("Select a retrieved publication and an editable bibliography.");
    const document = state.document;
    const text = document.source.toJSON();
    const version = document.getSnapshot().version;
    const selection = state.selection;
    const epoch = state.authorityEpoch;
    const isCurrent = () => {
      const current = latest.current;
      return !state.signal.aborted && current.run?.id === runId && current.authorityEpoch === epoch
        && current.document === document && !current.tracking && current.workspace.access.capabilities.edit
        && !current.security?.confidential && !document.getSnapshot().readOnly
        && document.source.toJSON() === text && document.getSnapshot().version.epoch === version.epoch
        && document.getSnapshot().version.revision === version.revision
        && current.selection.anchor === selection.anchor && current.selection.head === selection.head;
    };
    // The run endpoint rechecks current consent, actor, confidential and operator eligibility.
    const checked = editorValue(await state.client.call(endpoints.aiRunGet, {
      params: { id: runId }, query: {}, body: undefined, headers: state.headers,
    }, state.signal));
    if (!checked.findingsCurrent || !isCurrent() || !checked.sources.some(item => item.provider === selected.provider
      && item.providerId === selected.providerId && item.bibtex === selected.bibtex)) throw new TypeError("Publication or source context changed; nothing was copied.");
    const citationClient = state.citationClient;
    const guarded: EditorClient = { ...citationClient, async call(route, input, signal) {
      if (route.method === endpoints.citationCreate.method && route.path === endpoints.citationCreate.path) {
        // ready() has captured the writer's expected branch revision. Recheck review
        // eligibility after it; the existing writer rejects subsequent branch changes.
        const latestRun = editorValue(await state.client.call(endpoints.aiRunGet, {
          params: { id: runId }, query: {}, body: undefined, headers: state.headers,
        }, state.signal));
        if (!latestRun.findingsCurrent || !isCurrent()) throw new TypeError("Review context changed before bibliography dispatch.");
      }
      return citationClient.call(route, input, signal ?? state.signal);
    } };
    // Defer the writer's workspace refresh until source insertion has been acknowledged.
    const props = { ...state, client: guarded, authoring: state.authoring ?? null, refreshWorkspace: async () => {} };
    const file = await createToolsActions(props).citation(selected, IdSchema.parse(targetId));
    // Copy is already durable here. Any later failure must disclose that partial result.
    try {
      if (cite) {
        const afterCopy = editorValue(await state.client.call(endpoints.aiRunGet, {
          params: { id: runId }, query: {}, body: undefined, headers: state.headers,
        }, state.signal));
        if (!afterCopy.findingsCurrent || !isCurrent()) throw new TypeError("Source selection or review eligibility changed");
        await insertCommand(props, { command: `\\cite{${key}}`, isCurrent });
        await document.flush(state.signal);
      }
      await state.refreshWorkspace();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new TypeError(`Copied ${key} to ${file.path}; ${cite ? "citation insertion or workspace refresh" : "workspace refresh"} was not acknowledged: ${error.message}. Inspect current source before retrying.`, { cause: error });
    }
    state.setNotice(cite ? `Copied ${key} to ${file.path} and saved \\cite{${key}} in ${document.file.path}.`
      : `Copied ${key} to ${file.path}. Source was not changed.`);
  }
  return <section aria-label="Citation review" className="qa-assistant__claims">
    <h3>Claim assessments</h3>
    <p>Model assessments against retrieved publications, not verification of truth. Highlighting selects only the exact reviewed source version.</p>
    {!!run.findings.length && !run.findingsCurrent && <p role="status">The server source no longer matches this review. Findings are retained as past model assessments.</p>}
    {!run.findings.length && <p>No structured claim assessments were returned or retained. Assistant prose is not a source highlight.</p>}
    {run.findings.map((finding, index) => <article className="qa-assistant__source" key={`${finding.fileId}:${finding.from}:${index}`}>
      <strong>{finding.assessment === "unsupported" ? "Unsupported" : "Supported"} · model assessment</strong>
      <blockquote>{finding.quote}</blockquote><p>{finding.explanation}</p>
      <p>{finding.path} · UTF-16 {finding.from}–{finding.to} · revision {finding.revision} · epoch {finding.epoch}</p>
      <p>{finding.citations.map(citation => `${citation.provider}:${citation.providerId}`).join(", ") || "No retrieved publication linked to this claim"}</p>
      {state.document?.file.id !== finding.fileId
        ? <Button disabled={state.busy || state.tracking} onClick={() => void state.execute(() => state.navigation.openFile(finding.fileId))}>Open {finding.path}</Button>
        : <Button disabled={state.busy || state.tracking || !run.findingsCurrent || !state.authoring || !currentClaim(finding, state.document)}
          onClick={() => void state.execute(() => highlight(finding))}>Highlight claim</Button>}
      {state.document?.file.id === finding.fileId && !currentClaim(finding, state.document) && <p role="status">Source changed or is not synchronized. Request a new assessment before highlighting.</p>}
    </article>)}
    <h3>Retrieved publications</h3>
    <label>Publication to copy<select value={publicationId} onChange={event => setPublicationId(event.target.value)} disabled={state.busy}>
      <option value="">Select an actual retrieved publication</option>
      {run.sources.map(source => <option key={`${source.provider}:${source.providerId}`} value={`${source.provider}:${source.providerId}`}>{source.title}</option>)}
    </select></label>
    {selected && <div className="qa-assistant__source"><strong>{selected.title}</strong>
      <p>{selected.authors.join(", ")} · {selected.year ?? "Year unavailable"}</p>
      <p>{selected.provider} · {selected.providerId}</p>
      <p>Citation key: {key ?? "One valid BibTeX record is required"}</p><pre>{selected.bibtex}</pre>
    </div>}
    <label>Editable bibliography<select value={targetId} onChange={event => setTargetId(event.target.value)} disabled={state.busy}>
      <option value="">Select a .bib target</option>{targets.map(file => <option key={file.id} value={file.id}>{file.path}</option>)}
    </select></label>
    {!targets.length && <p>Create an editable, unlinked .bib file in Files first.</p>}
    {state.tracking && <p role="status">Pause Track changes before copying or citing. Your private draft is retained.</p>}
    <div className="qa-assistant__row">
      <Button disabled={!!disabled || !target || !key} onClick={() => void state.execute(() => copy(false))}>Copy publication</Button>
      <Button disabled={!!disabled || !target || !key || !state.authoring || !state.document}
        onClick={() => void state.execute(() => copy(true))}>Cite publication</Button>
    </div>
  </section>;
}
