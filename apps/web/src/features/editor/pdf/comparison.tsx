import { useEffect, useRef, useState } from "react";
import { ArtifactSchema, IdSchema, endpoints } from "@quire/contracts";
import type { Artifact, HistoryVersion } from "@quire/contracts";
import { Button } from "../../../ui";
import { editorValue } from "../shared";
import type { EditorClient, EditorWorkspace } from "../shared";
import { useArtifact } from "./artifact";
import { comparePdfs } from "./difference";
import type { PdfDifference } from "./difference";
import { PdfViewer } from "./viewer";
import { DifferencePages } from "./difference-pages";

export function PdfComparison({ client, workspace, onError }: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly onError: (error: Error) => void;
}) {
  const [versions, setVersions] = useState<readonly HistoryVersion[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<"side-by-side" | "overlay">("side-by-side");
  const [result, setResult] = useState<PdfDifference | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pdfView, setPdfView] = useState(false);
  const [page, setPage] = useState<{ readonly page: number; readonly xPt: number; readonly yPt: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const { data, error } = useArtifact({ client, workspace, artifact });
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      const all: HistoryVersion[] = [];
      let cursor: string | undefined;
      do {
        const next = editorValue(await client.call(endpoints.historyList, {
          params: { p: workspace.scope.projectId }, query: { branch: workspace.scope.branch, limit: 100, cursor },
          body: undefined, headers: workspace.requestHeaders,
        }, controller.signal));
        all.push(...next.items.filter(item => item.accessible));
        cursor = next.nextCursor ?? undefined;
      } while (cursor);
      if (controller.signal.aborted) return;
      setVersions(all);
      setFrom(all[1]?.snapshot.id ?? all[0]?.snapshot.id ?? "");
      setTo(all[0]?.snapshot.id ?? "");
      setLoading(false);
    })().catch(cause => {
      if (!(cause instanceof Error)) throw cause;
      if (!controller.signal.aborted) { onError(cause); setLoading(false); }
    });
    return () => { controller.abort(); abort.current?.abort(); };
  }, [client, workspace, onError]);
  const compare = async () => {
    const controller = new AbortController();
    abort.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]);
    setBusy(true); setResult(null); setArtifact(null);
    try {
      const next = await comparePdfs({ client, workspace, fromSnapshotId: IdSchema.parse(from),
        toSnapshotId: IdSchema.parse(to), mode, signal });
      const job = editorValue(await client.call(endpoints.compileGet, {
        params: { id: next.toJobId }, query: {}, body: undefined, headers: workspace.requestHeaders,
      }, signal));
      const output = job.artifacts.find(item => item.id === next.artifactId);
      if (!output) throw new TypeError("Rendered diff PDF is absent from its generating compile job");
      setResult(next); setArtifact(ArtifactSchema.parse(output)); setPage(null);
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      if (!controller.signal.aborted) onError(cause);
    } finally { setBusy(false); abort.current = null; }
  };
  const revision = (side: "From" | "To", value: string, setValue: (value: string) => void) =>
    <label>{side} revision <select aria-label={`${side} revision`} value={value} disabled={busy || loading} onChange={event => {
      setValue(event.target.value); setResult(null); setArtifact(null);
    }}>
      {versions.map(version => <option key={version.id} value={version.snapshot.id}>
        Revision {version.snapshot.revision}{version.labels.length ? ` · ${version.labels.map(label => label.name).join(", ")}` : ""}
      </option>)}
    </select></label>;
  return <div className="q-pdf-content">
    <div className="q-pdf-toolbar">
      {revision("From", from, setFrom)}{revision("To", to, setTo)}
      <label>Comparison mode <select aria-label="Comparison mode" value={mode} disabled={busy} onChange={event => {
        if (event.target.value === "side-by-side" || event.target.value === "overlay") {
          setMode(event.target.value); setResult(null); setArtifact(null);
        }
      }}><option value="side-by-side">Side by side</option><option value="overlay">Overlay</option></select></label>
      <Button variant="primary" disabled={busy || !from || !to || from === to || !workspace.access.capabilities.compile}
        onClick={() => void compare()}>Compare PDFs</Button>
      {busy && <Button onClick={() => abort.current?.abort()}>Stop waiting</Button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Compiling both historical snapshots and comparing rendered pages…</p>}
    {result && <div className="q-pdf-toolbar" aria-label="Changed PDF pages">
      <span>{result.regions.length} changed {result.regions.length === 1 ? "page" : "pages"}:</span>
      {result.regions.map(region => <Button key={region.page} onClick={() =>
        setPage({ page: region.page, xPt: region.x, yPt: region.y })}>Page {region.page}</Button>)}
      <Button aria-pressed={pdfView} onClick={() => setPdfView(!pdfView)}>{pdfView ? "View page regions" : "View diff PDF"}</Button>
      {data && !pdfView && <a className="q-button q-button--neutral q-button--regular"
        href={data.url} download={data.name}>Download diff PDF</a>}
      <p>Visual changes can include reflow. They are not semantic source differences.</p>
    </div>}
    {data && result ? pdfView ? <PdfViewer data={data} browser={false} location={page} onError={onError} /> :
      <DifferencePages client={client} workspace={workspace} result={result}
        page={page?.page ?? result.regions[0]?.page ?? 1} /> :
      <div className="q-pdf-body"><p>{loading ? "Loading historical revisions…" : versions.length < 2 ?
        "Save two history revisions to compare their compiled PDFs." : "Choose two revisions and compare their rendered PDFs."}</p></div>}
  </div>;
}
