import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Comment, Event } from "@quire/contracts";
import { Button, EmptyState, Spinner } from "../../../ui";
import { editorValue } from "../shared";
import type { ReviewPanelProps } from "../shared";
import { errorMessage, initials, localTime, PanelMessage } from "./common";
import { subscribeProjectEvents } from "./events";

export function ChatPanel({ client, workspace, document, refreshWorkspace }: ReviewPanelProps) {
  const [messages, setMessages] = useState<readonly Comment[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    if (!workspace.access.capabilities.chat) {
      setMessages([]);
      return;
    }
    const result = editorValue(await client.call(endpoints.chatList, {
      params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch },
      body: undefined, headers: workspace.requestHeaders,
    }));
    setMessages(result.items);
  }, [client, workspace]);

  const receiveEvent = useEffectEvent((event: Event) => {
    const action = event.topic === "review.changed" ? load() : refreshWorkspace();
    void action.catch(failure => setError(errorMessage(failure)));
  });
  useEffect(() => {
    const controller = new AbortController();
    void load().catch(failure => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    if (!workspace.access.capabilities.chat) return () => controller.abort();
    const subscription = subscribeProjectEvents({
      client, workspace, topics: new Set(["review.changed", "policy.changed", "access.changed"]),
      onOpen: () => setLive(true),
      onEvent: event => receiveEvent(event),
    });
    void subscription.promise.catch(failure => {
      if (!controller.signal.aborted && failure instanceof Error && failure.name !== "AbortError") {
        setError(errorMessage(failure));
      }
    });
    return () => { controller.abort(); subscription.dispose(); };
  }, [client, workspace.scope.projectId, workspace.scope.branch, workspace.requestHeaders["x-project-token"],
    workspace.access.capabilities.chat]);

  const persistence = document?.getSnapshot().persistence.kind;
  const online = persistence === undefined || (persistence !== "offline" && persistence !== "recovery"
    && persistence !== "closed" && persistence !== "connecting");
  const enabled = workspace.access.capabilities.chat && workspace.access.actorId !== null && online;
  const disabledReason = workspace.access.actorId === null
    ? "Anonymous link viewers cannot use project chat."
    : !workspace.access.capabilities.chat
      ? "Chat is disabled by current project or organization policy."
      : !online ? "Chat is unavailable while the editor is offline or recovering." : null;

  return <section className="quire-review__section quire-chat" aria-labelledby="chat-title"
    data-review-live={live ? "true" : "false"}>
    <header className="quire-review__section-header">
      <div><h2 id="chat-title">Project chat</h2>
        <p>Named collaborators share this branch conversation. Assistant chat remains separate.</p></div>
    </header>
    {disabledReason && <PanelMessage>{disabledReason}</PanelMessage>}
    {messages === null ? <div className="quire-review__loading"><Spinner label="Loading chat" /></div>
      : messages.length === 0 ? <EmptyState title="No chat messages"
        description={enabled ? "Send the first message to collaborators on this branch." : "There is no visible chat history."} />
      : <ol className="quire-chat__messages">{messages.map(message =>
        <li key={message.id} className={message.authorId === workspace.access.actorId ? "quire-chat__message quire-chat__message--own" : "quire-chat__message"}>
          <span className="quire-review__avatar" aria-hidden="true">{initials(
            message.authorId === workspace.access.actorId ? "You" : "Collaborator",
          )}</span>
          <article><header><strong>{message.authorId === workspace.access.actorId ? "You" : "Collaborator"}</strong>
            <time dateTime={message.createdAt}>{localTime(message.createdAt)}</time></header>
            <p>{message.body}</p></article>
        </li>)}</ol>}
    <form className="quire-chat__composer" onSubmit={event => {
      event.preventDefault();
      if (!enabled) return;
      setBusy(true); setError(null);
      void (async () => {
        try {
          const message = editorValue(await client.call(endpoints.chatCreate, {
            params: { p: workspace.scope.projectId }, query: {},
            body: { scope: workspace.scope, body, expectedVersion: workspace.access.branchRevision },
            headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
          }));
          setMessages(current => current ? [...current, message] : [message]);
          setBody("");
        } catch (failure) {
          setError(errorMessage(failure));
        } finally {
          setBusy(false);
        }
      })();
    }}>
      <label>Message<textarea rows={3} required disabled={!enabled} value={body}
        onChange={event => setBody(event.currentTarget.value)}
        placeholder={enabled ? "Message collaborators" : "Chat unavailable"} /></label>
      <Button variant="primary" type="submit" disabled={!enabled} busy={busy}>Send message</Button>
    </form>
    {error && <PanelMessage tone="error">{error}</PanelMessage>}
  </section>;
}
