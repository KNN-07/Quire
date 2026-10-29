import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Event, HistoryVersion, Id, ResponseOf } from "@quire/contracts";
import { Button, EmptyState, Modal, Spinner } from "../../../ui";
import { editorValue } from "../shared";
import type { ReviewPanelProps } from "../shared";
import { errorMessage, localTime, PanelMessage } from "./common";
import { subscribeProjectEvents } from "./events";
import { actorColor, ChangePreview, replacementSpan } from "./change-preview";

type Comparison = ResponseOf<typeof endpoints.historyCompare>;
type Changes = ResponseOf<typeof endpoints.historyChanges>;
type RestoreTarget = { readonly version: HistoryVersion; readonly fileIds?: readonly Id[] };
const historyReasonLabels = {
  checkpoint: "Checkpoint",
  compile: "Compile",
  commit: "Commit",
  restore: "Restore",
  import: "Import",
} as const satisfies Readonly<Record<HistoryVersion["snapshot"]["reason"], string>>;

export function HistoryPanel({ client, workspace, document, navigation, refreshWorkspace }: ReviewPanelProps) {
  const [versions, setVersions] = useState<readonly HistoryVersion[] | null>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [labelsOnly, setLabelsOnly] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selectedFile, setSelectedFile] = useState<Id | null>(null);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [actor, setActor] = useState("");
  const [label, setLabel] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const history = editorValue(await client.call(endpoints.historyList, {
      params: { p: workspace.scope.projectId },
      query: { branch: workspace.scope.branch, labelsOnly: "false" },
      body: undefined, headers: workspace.requestHeaders,
    }));
    setVersions(history.items);
    setSelectedId(current => history.items.some(version => version.id === current)
      ? current : history.items[0]?.id ?? null);
  }, [client, workspace]);

  const receiveEvent = useEffectEvent((event: Event) => {
    const action = event.topic === "policy.changed" || event.topic === "access.changed"
      ? refreshWorkspace() : load();
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
      client, workspace,
      topics: new Set(["history.created", "review.changed", "tree.changed", "policy.changed", "access.changed"]),
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

  const selected = versions?.find(version => version.id === selectedId) ?? null;
  const latest = versions?.[0] ?? null;
  const compareFrom = selected?.id === latest?.id ? versions?.[1] ?? null : selected;

  useEffect(() => {
    const controller = new AbortController();
    setComparison(null); setChanges(null); setChangesError(null); setActor("");
    if (!selected?.accessible || !latest?.accessible || !compareFrom?.accessible) {
      return () => controller.abort();
    }
    void client.call(endpoints.historyCompare, {
      params: { p: workspace.scope.projectId },
      query: {
        branch: workspace.scope.branch, from: compareFrom.id, to: latest.id,
      },
      body: undefined, headers: workspace.requestHeaders,
    }, controller.signal).then(result => {
      if (!controller.signal.aborted) setComparison(editorValue(result));
    }).catch(failure => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    void client.call(endpoints.historyChanges, {
      params: { p: workspace.scope.projectId },
      query: { branch: workspace.scope.branch, from: compareFrom.id, to: latest.id },
      body: undefined, headers: workspace.requestHeaders,
    }, controller.signal).then(result => {
      if (!controller.signal.aborted) setChanges(editorValue(result));
    }).catch(failure => {
      if (!controller.signal.aborted) setChangesError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [client, compareFrom, latest, selected, workspace]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(null); setSuccess(null);
    try { await action(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(null); }
  };

  const comparisonText = useMemo(() => comparison?.hunks.filter(hunk => !selectedFile || hunk.fileId === selectedFile).map(hunk =>
    `--- ${hunk.path}\n${hunk.before}\n+++ ${hunk.path}\n${hunk.after}`).join("\n\n") ?? "", [comparison, selectedFile]);
  const authorNames = new Map(changes?.participants.map((participant, index) =>
    [participant.id, participant.displayName ?? `Unknown actor ${index + 1}`]));
  const visibleChanges = changes?.changes.filter(change =>
    (!selectedFile || change.fileId === selectedFile) && (!actor || change.actorId === actor)) ?? [];

  if (versions === null) return <div className="quire-review__loading"><Spinner label="Loading history" />
    {error && <PanelMessage tone="error">{error}</PanelMessage>}</div>;
  if (versions.length === 0) return <EmptyState title="No history yet"
    description="A saved checkpoint, compile, commit, restore, import, or disconnect will create the first immutable version." />;

  const timeline = <aside className="quire-history__timeline">
      <header><div><h2 id="history-title">Versions</h2>
        <p>Every checkpoint is immutable; restoring creates a new version.</p></div>
        <div role="group" aria-label="History filter" className="quire-history__filter">
          <Button size="small" variant="ghost" aria-pressed={!labelsOnly} onClick={() => setLabelsOnly(false)}>All history</Button>
          <Button size="small" variant="ghost" aria-pressed={labelsOnly} onClick={() => {
            setLabelsOnly(true);
            const first = versions.find(version => version.labels.length > 0);
            if (first) { setSelectedId(first.id); setSelectedFile(null); }
          }}>Labels only</Button>
        </div>
      </header>
      {labelsOnly && !versions.some(version => version.labels.length > 0) && <p>No labeled versions.</p>}
      <ol>{versions.filter(version => !labelsOnly || version.labels.length > 0).map(version => <li key={version.id}>
        <button type="button" data-history-id={version.id} aria-pressed={version.id === selectedId}
          onClick={() => { setSelectedId(version.id); setSelectedFile(null); }}>
          <time dateTime={version.snapshot.createdAt}>{localTime(version.snapshot.createdAt)}</time>
          <strong>{version.labels.map(item => item.name).join(", ")
            || historyReasonLabels[version.snapshot.reason]}</strong>
          <span>Recorded by {version.authors.map(author => authorNames.get(author)
            ?? (author === workspace.access.actorId ? "you" : "an actor whose name is unavailable")).join(", ")}</span>
          {!version.accessible && <span>Source outside your history window</span>}
        </button>
      </li>)}</ol>
    </aside>;

  return <section className="quire-history" aria-labelledby="history-title"
    data-review-live={live ? "true" : "false"}>
    <main className="quire-history__detail">
      {selected && <><header className="quire-history__toolbar">
        <div><h2>{selected.labels[0]?.name ?? historyReasonLabels[selected.snapshot.reason]}</h2>
          <p>Revision {selected.snapshot.revision} · {localTime(selected.snapshot.createdAt)} · <span title="Recorded actors are checkpoint actors, not original text ownership">checkpoint actor</span></p></div>
        <div><Button onClick={() => void run("download", async () => {
          const bytes = editorValue(await client.call(endpoints.historySource, {
            params: { p: workspace.scope.projectId, id: selected.id },
            query: { branch: workspace.scope.branch }, body: undefined, headers: workspace.requestHeaders,
          }));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
          try {
            const anchor = window.document.createElement("a");
            anchor.href = url; anchor.download = `${workspace.project.name}-${selected.snapshot.revision}.zip`;
            anchor.click();
          } finally { URL.revokeObjectURL(url); }
          setSuccess("Source ZIP download started.");
        })} disabled={!selected.accessible} busy={busy === "download"}>Download source ZIP</Button>
          <Button variant="primary" disabled={!selected.accessible || !workspace.access.capabilities.edit}
            onClick={() => setRestoreTarget({ version: selected })}>Restore selected version</Button></div>
      </header>

      <div className="quire-history__labels">
        <h3>Labels</h3>
        <ul>{selected.labels.map(item => <li key={item.id}>{item.name}
          {workspace.access.capabilities.edit && <Button size="small" variant="ghost"
            onClick={() => void run(`remove-label-${item.id}`, async () => {
              editorValue(await client.call(endpoints.historyLabelDelete, {
                params: { p: workspace.scope.projectId, id: selected.id, labelId: item.id },
                query: {}, body: { expectedVersion: selected.version }, headers: workspace.requestHeaders,
              }));
              await load();
            })}>Remove</Button>}</li>)}</ul>
        {workspace.access.capabilities.edit && <form onSubmit={event => {
          event.preventDefault();
          void run("add-label", async () => {
            editorValue(await client.call(endpoints.historyLabel, {
              params: { p: workspace.scope.projectId, id: selected.id }, query: {},
              body: { name: label, expectedVersion: selected.version },
              headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
            }));
            setLabel(""); await load();
          });
        }}><label>New label<input required value={label}
            onChange={event => setLabel(event.currentTarget.value)} placeholder="Workshop submission" /></label>
          <Button size="small" type="submit" busy={busy === "add-label"}>Add label</Button></form>}
      </div>

      {!selected.accessible ? <PanelMessage>Source for this version is outside your configured history window.
        Its metadata remains visible, but download, comparison and restore are denied.</PanelMessage>
        : !compareFrom ? <EmptyState title="No earlier checkpoint to compare"
          description="This is the only accessible version in the current timeline." />
        : !compareFrom.accessible ? <PanelMessage>The previous version is outside your history window.
          Select an accessible version to compare.</PanelMessage>
        : comparison === null ? <div className="quire-review__loading"><Spinner label="Comparing versions" /></div>
        : <div className="quire-history__comparison">
          <header><div><h3>Changed files</h3><p>Comparing revision {compareFrom.snapshot.revision} with {latest?.snapshot.revision}.</p></div>
            <Button size="small" onClick={() => void run("copy-comparison", async () => {
              await navigator.clipboard.writeText(comparisonText); setSuccess("Comparison copied.");
            })}>Copy comparison</Button></header>
          <nav aria-label="Changed files"><button type="button" aria-pressed={selectedFile === null}
            onClick={() => setSelectedFile(null)}>All files</button>{[...new Map([
              ...comparison.files.map(file => [file.id, { id: file.id, path: file.path }] as const),
              ...(changes?.changes.map(change => [change.fileId, { id: change.fileId, path: change.path }] as const) ?? []),
            ]).values()].map(file => {
            const deleted = !workspace.files.some(current => current.id === file.id);
            return <button key={file.id} type="button" aria-pressed={selectedFile === file.id}
              onClick={() => setSelectedFile(file.id)}><span>{file.path}</span>
              {deleted && <strong>Deleted now</strong>}</button>;
          })}</nav>
          <h3>Recorded file changes</h3>
          <p className="quire-history__fine">Colors identify who applied each immutable file transition, not who originally wrote its text.
            Each preview shows one exact replacement span; retained text inside that span is not separately attributed.</p>
          {changesError ? <PanelMessage tone="error">{changesError} Recorded transitions are unavailable.
            No inaccessible intermediate source is shown.</PanelMessage>
            : changes === null ? <Spinner label="Loading recorded changes" />
            : <><label className="quire-review__compact-label">Recorded actor<select aria-label="Recorded actor" value={actor}
              onChange={event => setActor(event.currentTarget.value)}><option value="">All recorded actors</option>
              {changes.participants.map(participant => <option key={participant.id} value={participant.id}>
                {authorNames.get(participant.id)}</option>)}</select></label>
              <ul className="quire-change__legend" aria-label="Recorded actor legend">
                {changes.participants.map(participant => <li key={participant.id} data-actor-color={actorColor(participant.id)}>
                  <span aria-hidden="true" />{authorNames.get(participant.id)}</li>)}</ul>
              {visibleChanges.length === 0 && <PanelMessage>No recorded changes match this filter.</PanelMessage>}
              {visibleChanges.map(change => <article className="quire-change" key={change.id}
                data-change-id={change.id} data-actor-id={change.actorId} data-actor-color={actorColor(change.actorId)}>
                <header><strong>{change.path}</strong><span>Revision {change.fromRevision} to {change.toRevision}</span></header>
                <p>Applied by {authorNames.get(change.actorId)} · {historyReasonLabels[change.reason]} · {localTime(change.createdAt)}</p>
                {change.beforePath !== change.afterPath && <p>{change.beforePath ?? "File absent"} → {change.afterPath ?? "File absent"}</p>}
                {(change.beforePath !== null && change.before === null) || (change.afterPath !== null && change.after === null)
                  ? <PanelMessage>File metadata or binary content changed; no text attribution is available.</PanelMessage>
                  : <ChangePreview before={change.before ?? ""} after={change.after ?? ""} />}
                {workspace.files.some(file => file.id === change.fileId) && <Button size="small"
                  onClick={() => void run("navigate", async () => {
                    if (document?.file.id === change.fileId && change.after !== null
                      && document.source.toJSON() === change.after) {
                      const preceding = replacementSpan(change.before ?? "", change.after).prefix.split("\n");
                      await navigation.revealSource({ fileId: change.fileId, line: preceding.length,
                        column: (preceding.at(-1)?.length ?? 0) + 1 });
                    } else await navigation.openFile(change.fileId);
                  })}>Open current source</Button>}
                {!workspace.files.some(file => file.id === change.fileId) && <PanelMessage>Deleted now; historical coordinates are not live anchors.</PanelMessage>}
              </article>)}</>}
          {comparison.files.length === 0 && <EmptyState title="No file differences"
            description="The selected endpoints contain the same file paths and bytes; intermediate recorded changes may still exist." />}
          <details><summary>Endpoint before/after comparison</summary>
          {comparison.hunks.filter(hunk => !selectedFile || hunk.fileId === selectedFile).map(hunk => <article key={hunk.id}>
            <header><strong>{hunk.path}</strong><span>−{hunk.oldLines} +{hunk.newLines}</span></header>
            <div><section><h4>Before</h4><pre>{hunk.before || "File absent"}</pre></section>
              <section><h4>After</h4><pre>{hunk.after || "File absent"}</pre></section></div>
          </article>)}</details>
          {workspace.access.capabilities.edit && comparison.files.filter(file =>
            (!selectedFile || file.id === selectedFile) && !workspace.files.some(current => current.id === file.id))
            .map(file => <Button key={file.id} size="small" variant="primary"
              onClick={() => setRestoreTarget({ version: selected, fileIds: [file.id] })}>Recover deleted file</Button>)}
        </div>}
      <p className="quire-history__fine quire-history__note" role="note">Permanent comment tombstones remain deleted after source restore.</p>
      {error && <PanelMessage tone="error">{error}</PanelMessage>}
      {success && <PanelMessage tone="success">{success}</PanelMessage>}</>}
    </main>
    {timeline}

    <Modal open={restoreTarget !== null} onClose={() => setRestoreTarget(null)}
      title={restoreTarget?.fileIds ? "Recover deleted file" : "Restore project version"}
      description="Restore creates a new revision and document epoch. Collaborators must resynchronize; permanent comment tombstones are not resurrected."
      footer={<><Button onClick={() => setRestoreTarget(null)}>Cancel</Button>
        <Button variant="primary" busy={busy === "restore"} onClick={() => {
          if (!restoreTarget) return;
          void run("restore", async () => {
            editorValue(await client.call(endpoints.historyRestore, {
              params: { p: workspace.scope.projectId, id: restoreTarget.version.id }, query: {},
              body: {
                scope: workspace.scope, ...(restoreTarget.fileIds ? { fileIds: [...restoreTarget.fileIds] } : {}),
                expectedVersion: workspace.access.branchRevision,
              },
              headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
            }));
            setRestoreTarget(null);
            await Promise.all([load(), refreshWorkspace()]);
            setSuccess(restoreTarget.fileIds ? "Deleted file recovered in a new revision." : "Version restored in a new revision.");
          });
        }}>{restoreTarget?.fileIds ? "Recover file" : "Restore version"}</Button></>}>
      <p>{restoreTarget?.fileIds
        ? "Only the selected historical file is restored; unrelated current files are preserved."
        : "The complete historical tree becomes the new current revision."}</p>
    </Modal>
  </section>;
}
