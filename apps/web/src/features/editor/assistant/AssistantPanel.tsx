import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { assertNever } from "@quire/contracts";
import type { AiTool } from "@quire/contracts";
import { Button, Icon } from "../../../ui";
import type { PersistenceStatus } from "../shared";
import type { AssistantPanelProps } from "./types";
import { useAssistant } from "./use-assistant";
import type { AssistantState } from "./use-assistant";
import { AssistantAttachments, AssistantComposer, AssistantModes, useComposer } from "./Composer";
import type { ComposerState } from "./Composer";
import { AssistantReview } from "./Review";
import { AssistantPreferences } from "./Preferences";
import { AssistantConversation } from "./Conversation";
import { AssistantClaims } from "./Claims";
import { AssistantRunProgress } from "./RunProgress";
import "./assistant.css";

const subscribeEmpty = () => () => undefined;
const emptySnapshot = () => null;
type Suggestion = { readonly label: string; readonly tool: AiTool; readonly prompt: string; readonly range?: boolean };
const starters: readonly Suggestion[] = [
  { label: "Rewrite selection", tool: "paraphrase", prompt: "Rewrite the selected text so it reads more clearly.", range: true },
  { label: "Explain compile log", tool: "chat", prompt: "Explain the latest compile errors and warnings and how to fix them." },
  { label: "Make a table", tool: "table-prompt", prompt: "Make a LaTeX table with columns for " },
];
const followUps: readonly Suggestion[] = [
  { label: "Check every citation", tool: "citation-reviewer", prompt: "Check that every claim is supported by its citation." },
  { label: "Fix grammar", tool: "grammar", prompt: "Fix grammar in the selected text.", range: true },
  { label: "Make concise", tool: "concise", prompt: "Make the selected text more concise.", range: true },
];
function persistenceMessage(status: PersistenceStatus): string | null {
  switch (status.kind) {
    case "connecting": return "Source connecting. Generation waits for durable synchronization.";
    case "saving": return "Source saving. Generation waits for durable acknowledgment.";
    case "saved": return null;
    case "offline": return "Source offline. Reconnect before using AI; local edits are retained.";
    case "recovery": return `${status.code}: ${status.message}. Reopen a fresh document; do not overwrite retained local edits.`;
    case "closed": return `Source closed: ${status.reason}`;
    default: return assertNever(status);
  }
}
function Suggestions({ title, items, state, composer }: {
  readonly title?: string; readonly items: readonly Suggestion[];
  readonly state: AssistantState; readonly composer: ComposerState;
}) {
  const selected = state.selection.anchor !== state.selection.head && state.document !== null;
  return <div className="qa-assistant__suggestions">
    {title && <span>{title}</span>}
    <div>{items.map(item => <Button key={item.label} size="small" className="qa-assistant__suggestion"
      disabled={state.busy || composer.running} onClick={() => composer.suggest({ ...item, range: Boolean(item.range) && selected })}>{item.label}</Button>)}</div>
  </div>;
}
function Conversation({ state, composer }: { readonly state: AssistantState; readonly composer: ComposerState }) {
  const messages = state.conversation?.messages ?? state.run?.messages ?? [];
  const lastUser = messages.findLastIndex(message => message.role === "user");
  const runCard = state.run && <AssistantRunProgress run={state.run}>
    <details className="qa-assistant__run" aria-label="Run metadata"><summary>Run details · <code>{state.run.id}</code></summary>
      <dl><dt>Run ID</dt><dd>{state.run.id}</dd><dt>Version</dt><dd>{state.run.version}</dd><dt>Error code</dt><dd>{state.run.errorCode ?? "none"}</dd>
        <dt>Conversation ID</dt><dd>{state.run.conversationId ?? "private session"}</dd></dl>
    </details>
  </AssistantRunProgress>;
  const items: ReactNode[] = messages.map((message, index) => <article key={`${index}:${message.role}`}
    className={`qa-assistant__message qa-assistant__message--${message.role}`}>
    <strong>{message.role === "user" ? "You" : "Assistant"}</strong><p>{message.text}</p>
  </article>);
  // The current run belongs to the newest request, so it sits between that request and its reply.
  if (runCard) items.splice(lastUser + 1, 0, <div key="run" className="qa-assistant__run-slot">{runCard}</div>);
  const idle = !state.busy && !composer.running;
  return <>
    <section aria-label="Assistant messages" className="qa-assistant__messages">
      {!messages.length && !state.run && <div className="qa-assistant__empty"><Icon name="sparkle" size={20} />
        <p>Ask about your document, or switch to Agent to propose changes for review.</p>
        <Suggestions items={starters} state={state} composer={composer} />
      </div>}
      {items}
    </section>
    <AssistantReview state={state} key={`review:${state.run?.id ?? "no-run"}`} />
    <AssistantClaims state={state} key={`claims:${state.run?.id ?? "no-run"}`} />
    {!!state.run?.sources.length && state.run.tool !== "citation-reviewer" && <section aria-label="Retrieved publications" className="qa-assistant__sources">
      <h3>Retrieved sources</h3>
      {state.run.sources.map(source => <article className="qa-assistant__source" key={`${source.provider}:${source.providerId}`}>
        <span className="qa-assistant__source-page" aria-hidden="true" />
        <div>
          <strong>{source.title}</strong>
          <p>{source.authors.join(", ")} · {source.year ?? "Year unavailable"} · {source.provider} · {source.providerId}</p>
          {source.url && /^https?:\/\//u.test(source.url) && <a href={source.url} target="_blank" rel="noreferrer">View source</a>}
          <details><summary>BibTeX</summary><pre className="qa-assistant__code">{source.bibtex}</pre></details>
        </div>
      </article>)}
    </section>}
    {state.run && idle && <div className="qa-assistant__actions">
      <Button size="small" disabled={state.busy || !state.online || !composer.regeneratePrompt.trim()}
        onClick={() => void state.execute(() => composer.generate(composer.regeneratePrompt))}>Regenerate (new use)</Button>
    </div>}
    {state.run && idle && <Suggestions title="Try next" items={followUps} state={state} composer={composer} />}
  </>;
}
function Settings({ state }: { readonly state: AssistantState }) {
  return <section aria-label="Assistant settings" className="qa-assistant__governance">
    <h3>Assistant settings</h3>
    <p>{state.availability}</p>
    <p>{state.usage ? `${state.usage.month} usage · ${state.usage.used} used · ${state.usage.reserved} reserved · ${state.usage.refunded} refunded`
      : "Loading actual usage"}</p>
    <p className="qa-assistant__fine">Nothing is applied to your files until you accept. Generation and regeneration use the shared daily allowance.</p>
    <AssistantConversation state={state} />
    <AssistantPreferences state={state} />
  </section>;
}
function AssistantSession(props: AssistantPanelProps) {
  const state = useAssistant(props);
  const composer = useComposer(state);
  // Settings belong to the run they were opened on, so starting a new run returns to the conversation.
  const [settingsRun, setSettingsRun] = useState<string | null | undefined>(undefined);
  const runId = state.run?.id ?? null;
  const settings = settingsRun === runId;
  const document = useSyncExternalStore(props.document?.subscribe ?? subscribeEmpty,
    props.document?.getSnapshot ?? emptySnapshot);
  const persistence = document ? persistenceMessage(document.persistence) : null;
  return <section className="qa-assistant" aria-label="Assistant">
    <header className="qa-assistant__header"><Icon name="sparkle" /><h2>Assistant</h2>
      <AssistantModes state={state} composer={composer} />
      <span className="qa-assistant__spacer" />
      <Button variant="ghost" size="small" className="qa-assistant__icon" title="Refresh" aria-label="Refresh"
        disabled={state.busy || !state.online} onClick={() => void state.execute(async () => {
          if (state.run) await state.readRun(state.run.id);
          await state.refresh(); await state.refreshWorkspace();
        })}><Icon name="refresh" /><span className="q-sr-only">Refresh</span></Button>
      <Button variant="ghost" size="small" className="qa-assistant__icon" title="Assistant settings" aria-label="Assistant settings"
        aria-pressed={settings} onClick={() => setSettingsRun(settings ? undefined : runId)}><Icon name="settings" /></Button>
    </header>
    <div className="qa-assistant__body">
      {!state.online && <p role="alert" className="qa-assistant__banner">Offline. AI requests are unavailable until you reconnect.</p>}
      {!props.workspace.access.capabilities.edit && <p role="status" className="qa-assistant__banner">Viewer or review-only access. Agent edits cannot be accepted.</p>}
      {state.security?.confidential && <p role="status" className="qa-assistant__banner">Confidential project. AI context transmission is blocked by the owner label.</p>}
      {persistence && <div className="qa-assistant__recovery qa-assistant__banner" role="status"><p>{persistence}</p>
        {document?.persistence.kind === "recovery" && <details><summary>Retained local source</summary>
          <pre>{document.persistence.localText}</pre>
        </details>}
      </div>}
      {state.error && <p role="alert" className="qa-assistant__error qa-assistant__banner">{state.error}</p>}
      {state.notice && <p role="status" className="qa-assistant__notice">{state.notice}</p>}
      {settings ? <Settings state={state} /> : <Conversation state={state} composer={composer} />}
      {!settings && <AssistantAttachments state={state} composer={composer} />}
      {state.busy && <p role="status" className="qa-assistant__typing">Request in progress</p>}
    </div>
    {state.preferences ? <AssistantComposer state={state} composer={composer} />
      : <p role="status" className="qa-assistant__loading">Loading AI preferences</p>}
  </section>;
}
export function AssistantPanel(props: AssistantPanelProps) {
  return <AssistantSession {...props}
    key={`${props.workspace.scope.projectId}:${props.workspace.scope.branch}:${props.workspace.access.actorId}:${props.workspace.requestHeaders["x-project-token"] ?? ""}:${props.diagnosticFix?.key ?? props.threadContext?.key ?? ""}`} />;
}
