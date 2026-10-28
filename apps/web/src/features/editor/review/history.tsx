import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Event, HistoryVersion, Id, ResponseOf } from "@quire/contracts";
import { Button, EmptyState, Modal, Spinner } from "../../../ui";
import { editorValue } from "../shared";
import type { ReviewPanelProps } from "../shared";
import { errorMessage, localTime, PanelMessage } from "./common";
import { subscribeProjectEvents } from "./events";

type Comparison = ResponseOf<typeof endpoints.historyCompare>;
type RestoreTarget = { readonly version: HistoryVersion; readonly fileIds?: readonly Id[] };
const historyReasonLabels = {
  checkpoint: "Checkpoint",
  compile: "Compile",
  commit: "Commit",
  restore: "Restore",
  import: "Import",
} as const satisfies Readonly<Record<HistoryVersion["snapshot"]["reason"], string>>;

export function HistoryPanel({ client, workspace, refreshWorkspace }: ReviewPanelProps) {
  const [versions, setVersions] = useState<readonly HistoryVersion[] | null>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [labelsOnly, setLabelsOnly] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selectedFile, setSelectedFile] = useState<Id | null>(null);
  const [authorNames, setAuthorNames] = useState<ReadonlyMap<Id, string>>(new Map());
  const [label, setLabel] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const history = editorValue(await client.call(endpoints.historyList, {
      params: { p: workspace.scope.projectId },
      query: { branch: workspace.scope.branch, labelsOnly: labelsOnly ? "true" : "false" },
      body: undefined, headers: workspace.requestHeaders,
    }));
    setVersions(history.items);
    setSelectedId(current => history.items.some(version => version.id === current)
      ? current : history.items[0]?.id ?? null);
    if (workspace.access.capabilities.manageAccess) {
      const access = editorValue(await client.call(endpoints.accessGet, {
        params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch },
        body: undefined, headers: workspace.requestHeaders,
      }));
      setAuthorNames(new Map(access.members.map(member => [member.user.id, member.user.name])));
    }
  }, [client, labelsOnly, workspace]);

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
    if (!selected?.accessible || !latest?.accessible || !compareFrom) {
      setComparison(null);
      return () => controller.abort();
    }
    void client.call(endpoints.historyCompare, {
      params: { p: workspace.scope.projectId },
      query: {
        branch: workspace.scope.branch, from: compareFrom.id, to: latest.id,
        ...(selectedFile ? { fileId: selectedFile } : {}),
      },
      body: undefined, headers: workspace.requestHeaders,
    }, controller.signal).then(result => {
      setComparison(editorValue(result));
    }).catch(failure => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [client, compareFrom, latest, selected, selectedFile, workspace]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(null); setSuccess(null);
    try { await action(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(null); }
  };

  const comparisonText = useMemo(() => comparison?.hunks.map(hunk =>
    `--- ${hunk.path}\n${hunk.before}\n+++ ${hunk.path}\n${hunk.after}`).join("\n\n") ?? "", [comparison]);

  if (versions === null) return <div className="quire-review__loading"><Spinner label="Loading history" />
    {error && <PanelMessage tone="error">{error}</PanelMessage>}</div>;
  if (versions.length === 0) return <EmptyState title="No history yet"
    description="A saved checkpoint, compile, commit, restore, import, or disconnect will create the first immutable version." />;

  return <section className="quire-history" aria-labelledby="history-title"
    data-review-live={live ? "true" : "false"}>
    <aside className="quire-history__timeline">
      <header><div><h2 id="history-title">Versions</h2>
        <p>Every checkpoint is immutable; restoring creates a new version.</p></div>
        <div role="group" aria-label="History filter">
          <Button size="small" variant={labelsOnly ? "neutral" : "dark"} onClick={() => setLabelsOnly(false)}>All history</Button>
          <Button size="small" variant={labelsOnly ? "dark" : "neutral"} onClick={() => setLabelsOnly(true)}>Labels only</Button>
        </div>
      </header>
      <ol>{versions.map(version => <li key={version.id}>
        <button type="button" data-history-id={version.id} aria-pressed={version.id === selectedId}
          onClick={() => { setSelectedId(version.id); setSelectedFile(null); }}>
          <time dateTime={version.snapshot.createdAt}>{localTime(version.snapshot.createdAt)}</time>
          <strong>{version.labels.map(item => item.name).join(", ")
            || historyReasonLabels[version.snapshot.reason]}</strong>
          <span>{version.authors.map(author => authorNames.get(author) ?? "Former collaborator").join(", ")}</span>
          {!version.accessible && <span>Source outside your history window</span>}
        </button>
      </li>)}</ol>
    </aside>

    <main className="quire-history__detail">
      {selected && <><header className="quire-history__toolbar">
        <div><h2>{selected.labels[0]?.name ?? historyReasonLabels[selected.snapshot.reason]}</h2>
          <p>Revision {selected.snapshot.revision} · {localTime(selected.snapshot.createdAt)} · {selected.authors.length} author{selected.authors.length === 1 ? "" : "s"}</p></div>
        <div><Button onClick={() => void run("download", async () => {
          const bytes = editorValue(await client.call(endpoints.historySource, {
            params: { p: workspace.scope.projectId, id: selected.id },
            query: { branch: workspace.scope.branch }, body: undefined, headers: workspace.requestHeaders,
          }));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
          try {
            const anchor = document.createElement("a");
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
        : comparison === null ? <div className="quire-review__loading"><Spinner label="Comparing versions" /></div>
        : comparison.files.length === 0 ? <EmptyState title="No file differences"
          description="The selected checkpoints contain the same file paths and bytes." />
        : <div className="quire-history__comparison">
          <header><div><h3>Changed files</h3><p>Comparing revision {compareFrom.snapshot.revision} with {latest?.snapshot.revision}.</p></div>
            <Button size="small" onClick={() => void run("copy-comparison", async () => {
              await navigator.clipboard.writeText(comparisonText); setSuccess("Comparison copied.");
            })}>Copy comparison</Button></header>
          <nav aria-label="Changed files">{comparison.files.map(file => {
            const deleted = !workspace.files.some(current => current.id === file.id);
            return <button key={file.id} type="button" aria-pressed={selectedFile === file.id}
              onClick={() => setSelectedFile(file.id)}><span>{file.path}</span>
              {deleted && <strong>Deleted now</strong>}</button>;
          })}</nav>
          {comparison.hunks.map(hunk => <article key={hunk.id}>
            <header><strong>{hunk.path}</strong><span>−{hunk.oldLines} +{hunk.newLines}</span></header>
            <div><section><h4>Before</h4><pre>{hunk.before || "File absent"}</pre></section>
              <section><h4>After</h4><pre>{hunk.after || "File absent"}</pre></section></div>
            {workspace.access.capabilities.edit && !workspace.files.some(file => file.id === hunk.fileId) &&
              <Button size="small" variant="primary"
                onClick={() => setRestoreTarget({ version: selected, fileIds: [hunk.fileId] })}>Recover deleted file</Button>}
          </article>)}
        </div>}
      <PanelMessage>Permanent comment tombstones remain deleted after source restore.</PanelMessage>
      {error && <PanelMessage tone="error">{error}</PanelMessage>}
      {success && <PanelMessage tone="success">{success}</PanelMessage>}</>}
    </main>

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
