import { useRef, useState } from "react";
import { AiToolSchema, IdSchema, endpoints } from "@quire/contracts";
import type { AiTool } from "@quire/contracts";
import { Button, Icon } from "../../../ui";
import { editorValue } from "../shared";
import { AssistantContext, emptyContext } from "./Context";
import { tools } from "./tools";
import type { AssistantState } from "./use-assistant";

/** Composer state is shared by the header mode switch, body context cards and the pinned input. */
export function useComposer(state: AssistantState) {
  const editable = state.workspace.access.capabilities.edit;
  const [modeOverride, setMode] = useState<"ask" | "agent" | null>(null);
  const mode = modeOverride ?? (state.threadContext || !editable ? "ask" : state.diagnosticFix ? "agent" : state.preferences?.aiMode ?? "ask");
  const [tool, setToolValue] = useState<AiTool>(state.diagnosticFix ? "error-fix" : "chat");
  const [prompt, setPrompt] = useState(state.diagnosticFix ? "Fix only the selected compiler diagnostic. Propose changes for review."
    : state.threadContext ? "Help me address this review thread." : "");
  const [sent, setSent] = useState("");
  const [threadConsent, setThreadConsent] = useState(false);
  const [projectSearch, setProjectSearch] = useState(false);
  const [language, setLanguage] = useState("");
  const [choice, setChoice] = useState(() => state.diagnosticFix ? {
    ...emptyContext, diagnostic: state.diagnosticFix.diagnostic.id,
    files: state.diagnosticFix.diagnostic.fileId ? [state.diagnosticFix.diagnostic.fileId] : [],
  } : emptyContext);
  const input = useRef<HTMLTextAreaElement>(null);
  const running = state.run?.status === "queued" || state.run?.status === "running";
  const pending = state.run?.proposals.some(proposal => proposal.edits.some(edit => edit.status === "pending")) ?? false;
  const setTool = (value: AiTool) => { setToolValue(value); setProjectSearch(false); };
  async function generate(text = prompt) {
    if (state.threadContext && !threadConsent) throw new TypeError("Consent to the displayed review thread before sending it.");
    if (state.threadContext) {
      const current = await state.client.callWithMetadata(endpoints.threadGet, {
        params: { ...state.params, t: state.threadContext.thread.id },
        query: { branch: state.workspace.scope.branch }, body: undefined, headers: state.headers,
      }, state.signal);
      editorValue(current.result);
      if (current.metadata.expectedVersion !== state.threadContext.version) {
        throw new TypeError("Review thread changed. Clear this context and reopen the thread before sending.");
      }
    }
    await state.document?.flush(state.signal);
    const from = Math.min(state.selection.anchor, state.selection.head);
    const to = Math.max(state.selection.anchor, state.selection.head);
    if (choice.range && (!state.document || from === to)) throw new TypeError("Select a source range first");
    if (tool === "error-fix" && (!choice.diagnostic || !choice.diagnosticConsent)) throw new TypeError("Choose and consent to a diagnostic first");
    if (state.diagnosticFix) {
      const access = editorValue(await state.client.call(endpoints.projectAccess, {
        params: state.params, query: { branch: state.workspace.scope.branch }, body: undefined, headers: state.headers,
      }, state.signal));
      if (access.branchRevision !== state.diagnosticFix.revision) throw new TypeError("Diagnostic source changed. Recompile and choose a fresh diagnostic.");
      if (!access.capabilities.edit) throw new TypeError("Editing access is required");
    }
    if ((tool === "table-image" || tool === "equation-image") && (!choice.imageConsent || !choice.images.length)) {
      throw new TypeError("Attach an image with explicit consent first");
    }
    if (tool === "translate" && !language.trim()) throw new TypeError("Enter a target language");
    const selection = choice.range && state.document ? {
      fileId: state.document.file.id, from, to, text: state.document.source.toJSON().slice(from, to),
    } : undefined;
    const fileIds = selection && !choice.files.includes(selection.fileId) ? [...choice.files, selection.fileId] : choice.files;
    const created = editorValue(await state.client.call(endpoints.aiRunCreate, {
      params: state.params, query: {}, headers: { ...state.headers, "idempotency-key": crypto.randomUUID() },
      body: { scope: state.workspace.scope, mode, tool,
        prompt: state.threadContext ? JSON.stringify({
          instruction: tool === "translate" ? `${text}\nTarget language: ${language}` : text,
          reviewThread: { id: state.threadContext.thread.id, version: state.threadContext.version,
            scope: state.threadContext.thread.scope, resolved: state.threadContext.thread.resolved,
            quote: state.threadContext.thread.anchor?.quote ?? null, comments: state.threadContext.thread.comments },
        }) : tool === "translate" ? `${text}\nTarget language: ${language}` : text, fileIds: [...fileIds],
        ...(projectSearch && (tool === "chat" || tool === "texgpt") ? { projectSearch: true } : {}),
        ...(selection ? { selection } : {}),
        ...(choice.diagnosticConsent && choice.diagnostic ? { diagnosticId: IdSchema.parse(choice.diagnostic) } : {}),
        ...(choice.imageConsent && choice.images.length ? { imageUploadIds: [...choice.images] } : {}),
        ...(state.conversation ? { conversationId: state.conversation.id } : {}),
      },
    }, state.signal));
    state.updateRun(created);
    setSent(text);
    // Diagnostic and review-thread instructions stay with their attached context for a retry.
    if (!state.diagnosticFix && !state.threadContext) setPrompt(current => current === text ? "" : current);
    await state.readRun(created.id);
    await state.refresh();
  }
  async function cancel() {
    if (!state.run) return;
    const latest = await state.readRun(state.run.id);
    editorValue(await state.client.call(endpoints.aiRunCancel, {
      params: { id: latest.id }, query: {}, headers: state.headers, body: { expectedVersion: latest.version },
    }, state.signal));
    await state.readRun(latest.id); await state.refresh();
  }
  /** Fill the composer from a suggestion; nothing is sent until the user presses Send. */
  function suggest(next: { readonly tool: AiTool; readonly prompt: string; readonly range?: boolean }) {
    setTool(next.tool); setPrompt(next.prompt);
    if (next.range) setChoice(value => ({ ...value, range: true }));
    input.current?.focus();
  }
  return {
    mode, setMode, tool, setTool, prompt, setPrompt, threadConsent, setThreadConsent, projectSearch, setProjectSearch,
    language, setLanguage, choice, setChoice, input, running, pending, generate, cancel, suggest,
    /** The last sent message, reused by Regenerate after the input is cleared. */
    regeneratePrompt: sent || prompt,
  };
}
export type ComposerState = ReturnType<typeof useComposer>;

export function AssistantModes({ state, composer }: { readonly state: AssistantState; readonly composer: ComposerState }) {
  return <div className="qa-assistant__modes" role="group" aria-label="Assistant mode">
    <Button aria-pressed={composer.mode === "ask"} onClick={() => composer.setMode("ask")}>Ask</Button>
    <Button aria-pressed={composer.mode === "agent"} disabled={!state.workspace.access.capabilities.edit}
      onClick={() => composer.setMode("agent")}>Agent</Button>
  </div>;
}

/** Review-thread and diagnostic attachments render in the conversation, above the pinned composer. */
export function AssistantAttachments({ state, composer }: { readonly state: AssistantState; readonly composer: ComposerState }) {
  return <>
    {state.threadContext && <section aria-label="Selected review thread" className="qa-assistant__attachment">
      <header><Icon name="info" /><h3>Review thread context</h3></header>
      <p className="qa-assistant__fine">Captured version {state.threadContext.version}. Later replies and edits are not included.
        Only this displayed snapshot is sent after your consent.</p>
      {state.threadContext.thread.anchor && <blockquote>{state.threadContext.thread.anchor.quote}</blockquote>}
      <ol>{state.threadContext.thread.comments.map(comment => <li key={comment.id}>
        <strong>{comment.authorId === state.workspace.access.actorId ? "You" : "Collaborator"}</strong>
        <p>{comment.body}</p>
      </li>)}</ol>
      <label className="qa-assistant__check"><input type="checkbox" checked={composer.threadConsent}
        onChange={event => composer.setThreadConsent(event.currentTarget.checked)} />Send this review thread snapshot to the configured provider</label>
      <div className="qa-assistant__actions">
        {state.threadContext.thread.anchor && <Button size="small" onClick={() => void state.execute(async () => {
          const anchor = state.threadContext?.thread.anchor;
          if (anchor) await state.navigation.openFile(anchor.fileId);
        })}>Open referenced file</Button>}
        {state.onClearThreadContext && <Button size="small" onClick={state.onClearThreadContext}>Clear review thread context</Button>}
      </div>
    </section>}
    {state.diagnosticFix && <section aria-label="Selected diagnostic" className="qa-assistant__attachment">
      <header><Icon name="warning" /><h3>Fix compiler diagnostic</h3></header>
      <p>{state.diagnosticFix.diagnostic.message}</p>
      <p className="qa-assistant__fine">Compile revision {state.diagnosticFix.revision} · job {state.diagnosticFix.diagnostic.jobId}</p>
      <pre className="qa-assistant__code">{state.diagnosticFix.excerpt}</pre>
      <div className="qa-assistant__actions">
        <Button size="small" onClick={() => void state.execute(async () => {
          const item = state.diagnosticFix?.diagnostic;
          if (item?.fileId) await state.navigation.revealSource({ fileId: item.fileId, line: item.line ?? 1, column: item.column ?? 1 });
        })}>Open diagnostic source</Button>
        {state.onClearDiagnosticFix && <Button size="small" onClick={state.onClearDiagnosticFix}>Clear diagnostic context</Button>}
      </div>
    </section>}
  </>;
}

export function AssistantComposer({ state, composer }: { readonly state: AssistantState; readonly composer: ComposerState }) {
  const { mode, tool, prompt, running } = composer;
  const sendDisabled = !prompt.trim() || state.busy || running || !state.online || !state.workspace.access.actorId;
  return <form className="qa-assistant__composer" onSubmit={event => {
    event.preventDefault(); void state.execute(() => composer.generate());
  }}>
    <div className="qa-assistant__input">
      <AssistantContext state={state} choice={composer.choice} change={composer.setChoice} projectSearch={composer.projectSearch} />
      {composer.projectSearch && <p className="qa-assistant__fine">Project search may send readable text excerpts from other files in this branch to the configured provider.
        Quire checks your access for each search. Discovered excerpts are read-only context;
        proposed edits remain limited to your explicitly selected files and ranges.</p>}
      {tool === "translate" && <label className="qa-assistant__inline-field">Target language<input value={composer.language}
        onChange={event => composer.setLanguage(event.target.value)} /></label>}
      {tool === "inline-completion" && !state.preferences?.inlineCompletion && <p className="qa-assistant__fine">Enable inline completion in AI preferences first.</p>}
      {tool === "citation-reviewer" && <p className="qa-assistant__fine">Only publications retrieved from your selected, consented providers appear as sources.</p>}
      <label><span className="q-sr-only">Message the assistant</span><textarea ref={composer.input} rows={2} value={prompt}
        placeholder={mode === "ask" ? "Ask about your paper" : "Ask, or describe a change to propose"}
        onChange={event => composer.setPrompt(event.target.value)}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || sendDisabled) return;
          event.preventDefault(); event.currentTarget.form?.requestSubmit();
        }} /></label>
      <div className="qa-assistant__send">
        <label className="qa-assistant__tool"><span className="q-sr-only">Tool</span><select aria-label="Tool" value={tool}
          onChange={event => composer.setTool(AiToolSchema.parse(event.target.value))}>
          {AiToolSchema.options.map(value => <option value={value} key={value}>{tools[value]}</option>)}
        </select></label>
        {(tool === "chat" || tool === "texgpt") ? <section aria-label="Project search consent" className="qa-assistant__search">
          <label className="qa-assistant__check" title="Allow the assistant to search this project for this request"><input type="checkbox" checked={composer.projectSearch}
            aria-label="Allow the assistant to search this project for this request" disabled={state.busy || running}
            onChange={event => composer.setProjectSearch(event.currentTarget.checked)} /><span aria-hidden="true">Search project</span></label>
        </section> : <span className="qa-assistant__spacer" />}
        {running && <Button size="small" disabled={state.busy || !state.online}
          onClick={() => void state.execute(composer.cancel)}>Cancel run</Button>}
        <Button type="submit" aria-label="Send" title="Send (Enter)" className="qa-assistant__submit"
          variant={composer.pending ? "neutral" : "ai"} disabled={sendDisabled}><Icon name="arrowUp" /></Button>
      </div>
    </div>
    <p role="status" aria-label="Message visibility" className="qa-assistant__fine">
      {mode === "ask" ? "Ask mode · read only · " : "Agent mode · edits need your OK · "}{state.conversation
      ? `Shared with project collaborators in conversation ${state.conversation.id}.`
      : composer.projectSearch
        ? "Kept private to your session. Selected context and authorized project-search excerpts go to the configured provider."
        : "Kept private to your session. Selected context goes to the configured provider."}</p>
  </form>;
}
