import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Event, Thread } from "@quire/contracts";
import { Button, EmptyState, Spinner } from "../../../ui";
import { editorValue } from "../shared";
import type { ReviewPanelProps } from "../shared";
import { createAnchor, resolveAnchor } from "./anchors";
import { errorMessage, initials, localTime, PanelMessage } from "./common";
import { subscribeProjectEvents } from "./events";

type ThreadRecord = { readonly thread: Thread; readonly version: number };
type Status = "open" | "resolved" | "all";

export function ThreadsPanel(props: ReviewPanelProps) {
  const { client, workspace, document, selection, navigation, refreshWorkspace } = props;
  const [threads, setThreads] = useState<readonly ThreadRecord[] | null>(null);
  const [status, setStatus] = useState<Status>("open");
  const [body, setBody] = useState("");
  const [replies, setReplies] = useState<Readonly<Record<string, string>>>({});
  const [editing, setEditing] = useState<{ readonly id: string; readonly body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const page = editorValue(await client.call(endpoints.threadsList, {
      params: { p: workspace.scope.projectId },
      query: { branch: workspace.scope.branch, status },
      body: undefined, headers: workspace.requestHeaders,
    }));
    const records = await Promise.all(page.items.map(async item => {
      const response = await client.callWithMetadata(endpoints.threadGet, {
        params: { p: workspace.scope.projectId, t: item.id },
        query: { branch: workspace.scope.branch }, body: undefined, headers: workspace.requestHeaders,
      });
      const version = response.metadata.expectedVersion;
      if (version === null) throw new TypeError("Thread response omitted its version");
      return { thread: editorValue(response.result), version };
    }));
    setThreads(records);
  }, [client, status, workspace]);

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
  }, [client, workspace.scope.projectId, workspace.scope.branch, workspace.requestHeaders["x-project-token"]]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await action(); await load(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(null); }
  };

  const persistence = document?.getSnapshot().persistence.kind;
  const online = persistence !== "offline" && persistence !== "recovery"
    && persistence !== "closed" && persistence !== "connecting";
  const canComment = workspace.access.capabilities.review && online;
  const selectionSize = Math.abs(selection.head - selection.anchor);

  return <section className="quire-review__section" aria-labelledby="threads-title"
    data-review-live={live ? "true" : "false"}>
    <header className="quire-review__section-header">
      <div><h2 id="threads-title">Comments</h2>
        <p>Comments stay attached to their text as it is edited.</p></div>
      <label className="quire-review__compact-label">Show<select value={status}
        onChange={event => {
          const next = event.currentTarget.value;
          if (next === "open" || next === "resolved" || next === "all") setStatus(next);
        }}><option value="open">Open</option><option value="resolved">Resolved</option>
        <option value="all">All</option></select></label>
    </header>

    {canComment ? <form className="quire-review__form" onSubmit={event => {
      event.preventDefault();
      void run("create-thread", async () => {
        const anchor = document && selectionSize > 0 ? createAnchor(document, selection) : undefined;
        editorValue(await client.call(endpoints.threadCreate, {
          params: { p: workspace.scope.projectId }, query: {},
          body: {
            scope: workspace.scope, ...(anchor ? { anchor } : {}), body,
            expectedVersion: workspace.access.branchRevision,
          },
          headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
        }));
        setBody("");
      });
    }}>
      <label>{selectionSize > 0 ? `Comment on ${selectionSize} selected characters` : "Project comment"}
        <textarea required rows={3} value={body} onChange={event => setBody(event.currentTarget.value)}
          placeholder="Add a comment. Use @ to mention a collaborator." /></label>
      <Button variant="primary" type="submit" busy={busy === "create-thread"}>Comment</Button>
    </form> : <PanelMessage>{workspace.access.capabilities.review
      ? "Comments are unavailable while the document is offline, connecting, or in recovery."
      : "Your current role cannot add comments."}</PanelMessage>}

    {threads === null ? <div className="quire-review__loading"><Spinner label="Loading comments" /></div>
      : threads.length === 0 ? <EmptyState title={`No ${status === "all" ? "" : `${status} `}comments`}
        description={canComment ? "Select source text and add the first anchored comment." : "There are no comments to review."} />
      : <ol className="quire-thread-list">{threads.map(record => {
        const { thread } = record;
        const threadAnchor = thread.anchor;
        const anchor = threadAnchor && document ? resolveAnchor(document, threadAnchor) : null;
        const first = thread.comments[0];
        return <li key={thread.id} className="quire-thread">
          <header className="quire-thread__header">
            <div><strong>{thread.resolved ? "Resolved thread" : "Open thread"}</strong>
              {thread.anchor && <span>{anchor ? `Line ${anchor.location.line}` : "Anchor needs recovery"}</span>}</div>
            {props.onAskThread && <Button size="small" disabled={!online || !workspace.access.actorId || busy !== null}
              onClick={() => props.onAskThread?.({ key: crypto.randomUUID(), thread, version: record.version })}>
              Ask Assistant about thread</Button>}
            {threadAnchor && <Button size="small" variant="ghost" onClick={() => {
              if (anchor) void navigation.revealSource(anchor.location);
              else void navigation.openFile(threadAnchor.fileId);
            }}>Go to source</Button>}
          </header>
          {threadAnchor && <blockquote>{threadAnchor.quote || "Insertion point"}</blockquote>}
          <div className="quire-thread__comments">{thread.comments.map(comment =>
            <article key={comment.id} className="quire-thread__comment">
              <span className="quire-review__avatar" aria-hidden="true">{initials(
                comment.authorId === workspace.access.actorId ? "You" : "Collaborator",
              )}</span>
              <div><header><strong>{comment.authorId === workspace.access.actorId ? "You" : "Collaborator"}</strong>
                <time dateTime={comment.createdAt}>{localTime(comment.createdAt)}</time></header>
                {editing?.id === comment.id ? <form className="quire-thread__edit" onSubmit={event => {
                  event.preventDefault();
                  void run(`edit-${comment.id}`, async () => {
                    editorValue(await client.call(endpoints.commentPatch, {
                      params: { p: workspace.scope.projectId, id: comment.id }, query: {},
                      body: { body: editing.body, expectedVersion: comment.version },
                      headers: workspace.requestHeaders,
                    }));
                    setEditing(null);
                  });
                }}><textarea aria-label="Edit comment" value={editing.body}
                    onChange={event => setEditing({ id: comment.id, body: event.currentTarget.value })} />
                  <div><Button size="small" onClick={() => setEditing(null)}>Cancel</Button>
                    <Button size="small" variant="primary" type="submit">Save</Button></div></form>
                  : <p>{comment.body}</p>}
                {comment.authorId === workspace.access.actorId && editing?.id !== comment.id &&
                  <div className="quire-thread__actions"><Button size="small" variant="ghost"
                    onClick={() => setEditing({ id: comment.id, body: comment.body })}>Edit</Button>
                    <Button size="small" variant="danger" onClick={() => void run(`delete-comment-${comment.id}`, async () => {
                      editorValue(await client.call(endpoints.commentDelete, {
                        params: { p: workspace.scope.projectId, id: comment.id }, query: {},
                        body: { expectedVersion: comment.version }, headers: workspace.requestHeaders,
                      }));
                    })}>Delete</Button></div>}
              </div>
            </article>)}</div>
          {!thread.resolved && canComment && <form className="quire-thread__reply" onSubmit={event => {
            event.preventDefault();
            const reply = replies[thread.id] ?? "";
            void run(`reply-${thread.id}`, async () => {
              editorValue(await client.call(endpoints.threadReply, {
                params: { p: workspace.scope.projectId, t: thread.id }, query: {},
                body: { body: reply, expectedVersion: record.version },
                headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
              }));
              setReplies(current => ({ ...current, [thread.id]: "" }));
            });
          }}><label>Reply<input required value={replies[thread.id] ?? ""}
              onChange={event => setReplies(current => ({ ...current, [thread.id]: event.currentTarget.value }))}
              placeholder="Reply to this thread" /></label><Button size="small" type="submit">Reply</Button></form>}
          {workspace.access.capabilities.edit && <div className="quire-thread__actions">
            <Button size="small" variant={thread.resolved ? "neutral" : "dark"}
              onClick={() => void run(`state-${thread.id}`, async () => {
                editorValue(await client.call(endpoints.threadState, {
                  params: { p: workspace.scope.projectId, t: thread.id }, query: {},
                  body: { resolved: !thread.resolved, expectedVersion: record.version },
                  headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
                }));
              })}>{thread.resolved ? "Reopen" : "Resolve"}</Button>
            {thread.resolved && <Button size="small" variant="danger"
              onClick={() => void run(`delete-thread-${thread.id}`, async () => {
                editorValue(await client.call(endpoints.threadDelete, {
                  params: { p: workspace.scope.projectId, t: thread.id }, query: {},
                  body: { scope: workspace.scope, expectedVersion: record.version },
                  headers: workspace.requestHeaders,
                }));
              })}>Delete resolved thread</Button>}
          </div>}
          {!first && <PanelMessage tone="error">This thread has no surviving comments.</PanelMessage>}
        </li>;
      })}</ol>}
    {error && <PanelMessage tone="error">{error}</PanelMessage>}
  </section>;
}
