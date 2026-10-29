import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { endpoints } from "@quire/contracts";
import type { Event, Id, Suggestion } from "@quire/contracts";
import { Button, EmptyState, Spinner } from "../../../ui";
import { editorValue } from "../shared";
import type { ReviewPanelProps } from "../shared";
import { createAnchor, resolveAnchor } from "./anchors";
import { errorMessage, PanelMessage } from "./common";
import { subscribeProjectEvents } from "./events";
import { actorColor } from "./change-preview";

type SuggestionStatus = "all" | "pending" | "accepted" | "rejected" | "conflict";

export function SuggestionsPanel({ client, workspace, document, selection, navigation, refreshWorkspace }: ReviewPanelProps) {
  const [replacement, setReplacement] = useState("");
  const [suggestions, setSuggestions] = useState<readonly Suggestion[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [fileOnly, setFileOnly] = useState(true);
  const [status, setStatus] = useState<SuggestionStatus>("all");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectionSize = Math.abs(selection.head - selection.anchor);
  const persistence = document?.getSnapshot().persistence.kind;
  const online = persistence !== "offline" && persistence !== "recovery"
    && persistence !== "closed" && persistence !== "connecting";
  const source = useSyncExternalStore(
    useCallback((listener: () => void) => document?.subscribe(listener) ?? (() => {}), [document]),
    useCallback(() => document?.source.toJSON() ?? "", [document]),
  );
  const canSuggest = workspace.access.capabilities.review && workspace.access.benefits.trackChanges
    && document !== null && selectionSize > 0 && online;
  const authors = [...new Set(suggestions?.map(suggestion => suggestion.authorId) ?? [])].sort();
  const authorName = (id: Id) => id === workspace.access.actorId ? "You"
    : `Collaborator ${authors.indexOf(id) + 1} (name unavailable)`;
  const visible = (suggestions ?? []).filter(suggestion => !author || suggestion.authorId === author)
    .map(suggestion => ({ ...suggestion, edits: suggestion.edits.filter(edit =>
      (!fileOnly || edit.fileId === document?.file.id) && (status === "all" || edit.status === status)) }))
    .filter(suggestion => suggestion.edits.length > 0);
  const pending = visible.flatMap(suggestion => suggestion.edits
    .filter(edit => edit.status === "pending").map(edit => ({ suggestion, edit })));
  const selectedIds = pending.filter(item => selected.has(item.edit.id)).map(item => item.edit.id);

  const load = useCallback(async () => {
    const page = editorValue(await client.call(endpoints.suggestionsList, {
      params: { p: workspace.scope.projectId },
      query: {
        branch: workspace.scope.branch,
        status: "all",
      },
      body: undefined, headers: workspace.requestHeaders,
    }));
    setSuggestions(page.items);
  }, [client, workspace]);

  const receiveEvent = useEffectEvent((event: Event) => {
    const action = event.topic === "tree.changed"
      ? Promise.all([refreshWorkspace(), load()]).then(() => undefined)
      : load();
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
      client, workspace, topics: new Set(["review.changed", "tree.changed"]),
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
    try { await action(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(null); }
  };

  const decide = async (decision: "accept" | "reject", editIds: readonly string[]) => {
    const ids = [...new Set((suggestions ?? []).filter(suggestion =>
      suggestion.edits.some(edit => editIds.includes(edit.id))).map(suggestion => suggestion.id))];
    if (ids.length === 0) return;
    await run(`${decision}-${editIds.join("-")}`, async () => {
      editorValue(await client.call(endpoints.suggestionDecide, {
        params: { p: workspace.scope.projectId }, query: {},
        body: {
          ids, editIds: [...editIds], decision,
          expectedVersion: workspace.access.branchRevision,
        },
        headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
      }));
      setSelected(new Set());
      await Promise.all([refreshWorkspace(), load()]);
    });
  };

  return <section className="quire-review__section" aria-labelledby="suggestions-title">
    <header className="quire-review__section-header">
      <div><h2 id="suggestions-title">Tracked proposals</h2>
        <p>Reviewers propose exact source replacements; only Editors and Owners can decide them.</p></div>
      <label className="quire-review__compact-label">Status<select value={status}
        onChange={event => {
          const next = event.currentTarget.value;
          if (next === "all" || next === "pending" || next === "accepted"
            || next === "rejected" || next === "conflict") setStatus(next);
        }}><option value="all">All</option><option value="pending">Pending</option>
        <option value="accepted">Accepted</option><option value="rejected">Rejected</option>
        <option value="conflict">Conflict</option></select></label>
    </header>
    <div className="quire-suggestion__scope" role="group" aria-label="Proposal scope">
      <Button size="small" variant={fileOnly ? "dark" : "neutral"} onClick={() => { setFileOnly(true); setSelected(new Set()); }}>This file</Button>
      <Button size="small" variant={fileOnly ? "neutral" : "dark"} onClick={() => { setFileOnly(false); setSelected(new Set()); }}>Overview</Button>
    </div>
    <nav className="quire-suggestion__scope" aria-label="Files with proposals">
      {workspace.files.filter(file => suggestions?.some(suggestion => suggestion.edits.some(edit => edit.fileId === file.id)))
        .map(file => <Button key={file.id} size="small" variant={fileOnly && document?.file.id === file.id ? "dark" : "neutral"}
          onClick={() => void run("open-file", async () => {
            setFileOnly(true); setSelected(new Set()); await navigation.openFile(file.id);
          })}>{file.path} ({suggestions?.flatMap(suggestion => suggestion.edits)
            .filter(edit => edit.fileId === file.id && edit.status === "pending").length ?? 0} pending)</Button>)}
    </nav>
    <label className="quire-review__compact-label">Proposal author<select aria-label="Proposal author" value={author}
      onChange={event => { setAuthor(event.currentTarget.value); setSelected(new Set()); }}>
      <option value="">All proposal authors</option>{authors.map(id => <option key={id} value={id}>{authorName(id)}</option>)}
    </select></label>
    <ul className="quire-change__legend" aria-label="Proposal author legend">{authors.map(id =>
      <li key={id} data-actor-color={actorColor(id)}><span aria-hidden="true" />{authorName(id)}</li>)}</ul>
    <p>Colors identify persisted proposal authors, not the editor who later accepts a proposal.
      Previews are read-only; ordinary source typing is not tracked by this panel.</p>
    <form className="quire-review__form" onSubmit={event => {
      event.preventDefault();
      if (!document) return;
      void run("create-suggestion", async () => {
        const anchor = createAnchor(document, selection);
        const created = editorValue(await client.call(endpoints.suggestionCreate, {
          params: { p: workspace.scope.projectId }, query: {},
          body: {
            scope: workspace.scope,
            edits: [{
              fileId: document.file.id, anchor, before: anchor.quote, after: replacement,
              baseRevision: workspace.access.branchRevision,
            }],
            expectedVersion: workspace.access.branchRevision,
          },
          headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
        }));
        setSuggestions(current => current ? [created, ...current] : [created]);
        setReplacement("");
      });
    }}>
      <label>Replacement text<textarea rows={3} value={replacement}
        disabled={!canSuggest} onChange={event => setReplacement(event.currentTarget.value)}
        placeholder={selectionSize > 0 ? "Replace the selected source with…" : "Select source text first"} /></label>
      <Button variant="primary" type="submit" disabled={!canSuggest} busy={busy === "create-suggestion"}>
        Propose replacement
      </Button>
    </form>
    {suggestions === null ? <div className="quire-review__loading"><Spinner label="Loading proposals" /></div>
      : visible.length === 0 ? <EmptyState title="No tracked proposals"
        description={status === "all" ? "Select source text to propose a replacement." : `No ${status} proposals match this scope.`} />
      : <>{pending.length > 0 && <div className="quire-suggestion__bulk">
        <span>{pending.length} pending edit{pending.length === 1 ? "" : "s"}</span>
        {workspace.access.capabilities.edit && <><Button size="small" onClick={() => void decide("reject", pending.map(item => item.edit.id))}>Reject all</Button>
        <Button size="small" variant="success"
          onClick={() => void decide("accept", pending.map(item => item.edit.id))}>Accept all</Button></>}
      </div>}
    <ol className="quire-suggestion-list">{visible.flatMap(suggestion => suggestion.edits.map(edit => {
      const anchor = document ? resolveAnchor(document, edit.anchor) : null;
      const path = workspace.files.find(file => file.id === edit.fileId)?.path;
      return <li key={edit.id} className={`quire-suggestion quire-suggestion--${edit.status}`}
        data-proposal-id={edit.id} data-author-id={suggestion.authorId} data-actor-color={actorColor(suggestion.authorId)}>
        <header><strong>Proposed by {authorName(suggestion.authorId)}</strong>
          <p>{path ?? "Deleted file"}{anchor ? ` · line ${anchor.location.line}` : ""}</p></header>
        <label className="quire-suggestion__select"><input type="checkbox"
          checked={selected.has(edit.id)} disabled={edit.status !== "pending" || !workspace.access.capabilities.edit}
          onChange={event => {
            const checked = event.currentTarget.checked;
            setSelected(current => {
              const next = new Set(current);
              if (checked) next.add(edit.id); else next.delete(edit.id);
              return next;
            });
          }} />Select edit</label>
        {anchor && edit.status === "pending" ? <pre className="quire-change__source" aria-label="Anchored proposal preview"><code>
          {source.slice(source.lastIndexOf("\n", Math.max(0, anchor.from - 1)) + 1, anchor.from)}
          <del>{edit.before}</del><ins>{edit.after}</ins>
          {source.slice(anchor.to, source.indexOf("\n", anchor.to) < 0 ? source.length : source.indexOf("\n", anchor.to))}
        </code></pre> : <><div className="quire-suggestion__diff"><del>{edit.before || "Insertion point"}</del><ins>{edit.after || "Delete selection"}</ins></div>
          <p>{edit.status !== "pending" ? "Recorded proposal; not a live source overlay."
            : document?.file.id !== edit.fileId ? "Open this file to resolve its source anchor."
              : "Anchor no longer matches the current source; preview is not applied."}</p></>}
        {path && <Button size="small" onClick={() => void run("navigate", async () => {
          if (anchor) await navigation.revealSource(anchor.location);
          else await navigation.openFile(edit.fileId);
        })}>{anchor ? "Go to proposal source" : "Open proposal file"}</Button>}
        <strong>{edit.status === "conflict" ? "Conflict: source no longer matches" : edit.status}</strong>
        {edit.status === "pending" && workspace.access.capabilities.edit && <div className="quire-thread__actions">
          <Button size="small" onClick={() => void decide("reject", [edit.id])}>Reject</Button>
          <Button size="small" variant="success" onClick={() => void decide("accept", [edit.id])}>Accept</Button>
        </div>}
      </li>;
    }))}</ol>
    {selectedIds.length > 0 && workspace.access.capabilities.edit && <div className="quire-suggestion__selected">
      <span>{selectedIds.length} selected</span>
      <Button size="small" onClick={() => void decide("reject", selectedIds)}>Reject selected</Button>
      <Button size="small" variant="success" onClick={() => void decide("accept", selectedIds)}>Accept selected</Button>
    </div>}</>}
    {error && <PanelMessage tone="error">{error}</PanelMessage>}
  </section>;
}
