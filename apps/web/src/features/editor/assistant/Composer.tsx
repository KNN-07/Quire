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
    state.workspace.access.capabilities.edit ? state.preferences?.aiMode ?? "ask" : "ask");
  const [tool, setTool] = useState<AiTool>("chat");
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState("");
  const [choice, setChoice] = useState(emptyContext);
  const running = state.run?.status === "queued" || state.run?.status === "running";
  const pending = state.run?.proposals.some(proposal => proposal.edits.some(edit => edit.status === "pending"));
  async function generate() {
    await state.document?.flush(state.signal);
    const from = Math.min(state.selection.anchor, state.selection.head);
    const to = Math.max(state.selection.anchor, state.selection.head);
    if (choice.range && (!state.document || from === to)) throw new TypeError("Select a source range first");
    if (tool === "error-fix" && (!choice.diagnostic || !choice.diagnosticConsent)) throw new TypeError("Choose and consent to a diagnostic first");
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
        prompt: tool === "translate" ? `${prompt}\nTarget language: ${language}` : prompt, fileIds: [...fileIds],
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
