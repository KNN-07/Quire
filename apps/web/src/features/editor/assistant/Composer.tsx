import { useState } from "react";
import { AiToolSchema, IdSchema, endpoints } from "@quire/contracts";
import type { AiTool } from "@quire/contracts";
import { Button } from "../../../ui";
import { editorValue } from "../shared";
import { AssistantContext, emptyContext } from "./Context";
import { tools } from "./tools";
import type { AssistantState } from "./use-assistant";

export function AssistantComposer({ state }: { readonly state: AssistantState }) {
  const [mode, setMode] = useState<"ask" | "agent">(
    state.threadContext ? "ask" : state.workspace.access.capabilities.edit ? state.diagnosticFix ? "agent" : state.preferences?.aiMode ?? "ask" : "ask");
  const [tool, setTool] = useState<AiTool>(state.diagnosticFix ? "error-fix" : "chat");
  const [prompt, setPrompt] = useState(state.diagnosticFix ? "Fix only the selected compiler diagnostic. Propose changes for review."
    : state.threadContext ? "Help me address this review thread." : "");
  const [threadConsent, setThreadConsent] = useState(false);
  const [language, setLanguage] = useState("");
  const [choice, setChoice] = useState(() => state.diagnosticFix ? {
    ...emptyContext, diagnostic: state.diagnosticFix.diagnostic.id,
    files: state.diagnosticFix.diagnostic.fileId ? [state.diagnosticFix.diagnostic.fileId] : [],
  } : emptyContext);
  const running = state.run?.status === "queued" || state.run?.status === "running";
  const pending = state.run?.proposals.some(proposal => proposal.edits.some(edit => edit.status === "pending"));
  async function generate() {
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
          instruction: tool === "translate" ? `${prompt}\nTarget language: ${language}` : prompt,
          reviewThread: { id: state.threadContext.thread.id, version: state.threadContext.version,
            scope: state.threadContext.thread.scope, resolved: state.threadContext.thread.resolved,
            quote: state.threadContext.thread.anchor?.quote ?? null, comments: state.threadContext.thread.comments },
        }) : tool === "translate" ? `${prompt}\nTarget language: ${language}` : prompt, fileIds: [...fileIds],
        ...(selection ? { selection } : {}),
        ...(choice.diagnosticConsent && choice.diagnostic ? { diagnosticId: IdSchema.parse(choice.diagnostic) } : {}),
        ...(choice.imageConsent && choice.images.length ? { imageUploadIds: [...choice.images] } : {}),
        ...(state.conversation ? { conversationId: state.conversation.id } : {}),
      },
    }, state.signal));
    state.updateRun(created);
    await state.readRun(created.id);
    await state.refresh();
  }
  return <form className="qa-assistant__composer" onSubmit={event => {
    event.preventDefault(); void state.execute(generate);
  }}>
    {state.threadContext && <section aria-label="Selected review thread">
      <h3>Review thread context</h3>
      <p>Captured version {state.threadContext.version}. Later replies and edits are not included.
        Only this displayed snapshot is sent after your consent.</p>
      {state.threadContext.thread.anchor && <blockquote>{state.threadContext.thread.anchor.quote}</blockquote>}
      <ol>{state.threadContext.thread.comments.map(comment => <li key={comment.id}>
        <strong>{comment.authorId === state.workspace.access.actorId ? "You" : "Collaborator"}</strong>
        <p>{comment.body}</p>
      </li>)}</ol>
      <label className="qa-assistant__check"><input type="checkbox" checked={threadConsent}
        onChange={event => setThreadConsent(event.currentTarget.checked)} />Send this review thread snapshot to the configured provider</label>
      {state.threadContext.thread.anchor && <Button onClick={() => void state.execute(async () => {
        const anchor = state.threadContext?.thread.anchor;
        if (anchor) await state.navigation.openFile(anchor.fileId);
      })}>Open referenced file</Button>}
      {state.onClearThreadContext && <Button onClick={state.onClearThreadContext}>Clear review thread context</Button>}
    </section>}
    {state.diagnosticFix && <section aria-label="Selected diagnostic">
      <h3>Fix compiler diagnostic</h3>
      <p>{state.diagnosticFix.diagnostic.message}</p>
      <p>Compile revision {state.diagnosticFix.revision} · job {state.diagnosticFix.diagnostic.jobId}</p>
      <pre>{state.diagnosticFix.excerpt}</pre>
      <Button onClick={() => void state.execute(async () => {
        const item = state.diagnosticFix?.diagnostic;
        if (item?.fileId) await state.navigation.revealSource({ fileId: item.fileId, line: item.line ?? 1, column: item.column ?? 1 });
      })}>Open diagnostic source</Button>
      {state.onClearDiagnosticFix && <Button onClick={state.onClearDiagnosticFix}>Clear diagnostic context</Button>}
    </section>}
    <div className="qa-assistant__row" role="group" aria-label="Assistant mode">
      <Button aria-pressed={mode === "ask"} onClick={() => setMode("ask")}>Ask</Button>
      <Button aria-pressed={mode === "agent"} disabled={!state.workspace.access.capabilities.edit} onClick={() => setMode("agent")}>Agent</Button>
      <span>{mode === "ask" ? "Read only" : "Propose edits for review"}</span>
    </div>
    <label>Tool<select aria-label="Tool" value={tool} onChange={event => setTool(AiToolSchema.parse(event.target.value))}>
      {AiToolSchema.options.map(value => <option value={value} key={value}>{tools[value]}</option>)}
    </select></label>
    <AssistantContext state={state} choice={choice} change={setChoice} />
    {tool === "translate" && <label>Target language<input value={language} onChange={event => setLanguage(event.target.value)} /></label>}
    {tool === "inline-completion" && !state.preferences?.inlineCompletion && <p>Enable inline completion in AI preferences first.</p>}
    {tool === "citation-reviewer" && <p>Only publications retrieved from your selected, consented providers appear as sources.</p>}
    <label>Message the assistant<textarea rows={3} value={prompt} placeholder="Ask, or describe a change"
      onChange={event => setPrompt(event.target.value)} /></label>
    <p role="status" aria-label="Message visibility">{state.conversation
      ? `Send shares this new message and its response with project collaborators in conversation ${state.conversation.id}.`
      : "Send keeps this conversation private to your session. It still sends your selected context to the configured provider."}</p>
    <p>Nothing is applied to your files until you accept. Generation and regeneration use the shared daily allowance.</p>
    <div className="qa-assistant__row">
      <Button type="submit" variant={pending ? "neutral" : "ai"}
        disabled={!prompt.trim() || state.busy || running || !state.online || !state.workspace.access.actorId}>Send</Button>
      {state.run && !running && <Button disabled={state.busy || !state.online || !prompt.trim()}
        onClick={() => void state.execute(generate)}>Regenerate (new use)</Button>}
      {running && <Button disabled={state.busy || !state.online} onClick={() => void state.execute(async () => {
        if (!state.run) return;
        const latest = await state.readRun(state.run.id);
        editorValue(await state.client.call(endpoints.aiRunCancel, {
          params: { id: latest.id }, query: {}, headers: state.headers, body: { expectedVersion: latest.version },
        }, state.signal));
        await state.readRun(latest.id); await state.refresh();
      })}>Cancel run</Button>}
    </div>
  </form>;
}
