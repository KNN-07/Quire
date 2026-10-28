import { useSyncExternalStore } from "react";
import { assertNever } from "@quire/contracts";
import { Button, Icon } from "../../../ui";
import type { PersistenceStatus } from "../shared";
import type { AssistantPanelProps } from "./types";
import { useAssistant } from "./use-assistant";
import { AssistantComposer } from "./Composer";
import { AssistantReview } from "./Review";
import { AssistantPreferences } from "./Preferences";
import { AssistantConversation } from "./Conversation";
import "./assistant.css";

const subscribeEmpty = () => () => undefined;
const emptySnapshot = () => null;
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
function AssistantSession(props: AssistantPanelProps) {
  const state = useAssistant(props);
  const document = useSyncExternalStore(props.document?.subscribe ?? subscribeEmpty,
    props.document?.getSnapshot ?? emptySnapshot);
  const messages = state.conversation?.messages ?? state.run?.messages ?? [];
  const persistence = document ? persistenceMessage(document.persistence) : null;
  return <section className="qa-assistant" aria-label="Assistant">
    <header className="qa-assistant__header"><Icon name="sparkle" /><h2>Assistant</h2>
      <Button disabled={state.busy || !state.online} onClick={() => void state.execute(async () => {
        if (state.run) await state.readRun(state.run.id);
        await state.refresh(); await state.refreshWorkspace();
      })}>Refresh</Button>
    </header>
    <div className="qa-assistant__body">
      {!state.online && <p role="alert">Offline. AI requests are unavailable until you reconnect.</p>}
      {!props.workspace.access.capabilities.edit && <p role="status">Viewer or review-only access. Agent edits cannot be accepted.</p>}
      {state.security?.confidential && <p role="status">Confidential project. AI context transmission is blocked by the owner label.</p>}
      {persistence && <div className="qa-assistant__recovery" role="status"><p>{persistence}</p>
        {document?.persistence.kind === "recovery" && <details><summary>Retained local source</summary>
          <pre>{document.persistence.localText}</pre>
        </details>}
      </div>}
      {state.error && <p role="alert" className="qa-assistant__error">{state.error}</p>}
      {state.notice && <p role="status">{state.notice}</p>}
      {state.busy && <p role="status">Request in progress</p>}
      <AssistantReview state={state} />
      {state.run && <section className="qa-assistant__run" aria-label="Run metadata">
        <h3>{state.run.mode === "agent" ? "Agent" : "Ask"} run · {state.run.status}</h3>
        <dl><dt>Run ID</dt><dd>{state.run.id}</dd><dt>Version</dt><dd>{state.run.version}</dd><dt>Error code</dt><dd>{state.run.errorCode ?? "none"}</dd>
          <dt>Conversation ID</dt><dd>{state.run.conversationId ?? "private session"}</dd></dl>
      </section>}
      <section aria-label="Assistant messages" className="qa-assistant__messages">
        {!messages.length && <p>Select context and ask about your document, or choose Agent to propose changes for review.</p>}
        {messages.map((message, index) => <article key={`${index}:${message.role}`} className={`qa-assistant__message qa-assistant__message--${message.role}`}>
          <strong>{message.role === "user" ? "You" : "Assistant"}</strong><p>{message.text}</p>
        </article>)}
      </section>
      {!!state.run?.sources.length && <section aria-label="Retrieved publications"><h3>Retrieved sources</h3>
        {state.run.sources.map(source => <article className="qa-assistant__source" key={`${source.provider}:${source.providerId}`}>
          <strong>{source.title}</strong><p>{source.authors.join(", ")} · {source.year ?? "Year unavailable"}</p>
          <p>{source.provider} · {source.providerId}</p>
          {source.url && /^https?:\/\//u.test(source.url) && <a href={source.url} target="_blank" rel="noreferrer">View source</a>}
          <pre>{source.bibtex}</pre>
        </article>)}
      </section>}
      {state.preferences ? <AssistantComposer state={state} /> : <p role="status">Loading AI preferences</p>}
      <div className="qa-assistant__governance">
        <p>{state.availability}</p>
        <p>{state.usage ? `${state.usage.month} usage · ${state.usage.used} used · ${state.usage.reserved} reserved · ${state.usage.refunded} refunded`
          : "Loading actual usage"}</p>
        <AssistantConversation state={state} />
        <AssistantPreferences state={state} />
      </div>
    </div>
  </section>;
}
export function AssistantPanel(props: AssistantPanelProps) {
  return <AssistantSession {...props}
    key={`${props.workspace.scope.projectId}:${props.workspace.scope.branch}:${props.workspace.access.actorId}:${props.workspace.requestHeaders["x-project-token"] ?? ""}`} />;
}
