import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy, PageViewport, RenderTask } from "pdfjs-dist";
import { Button, Field, Icon } from "../../../ui";
import type { PdfLocation } from "../shared";
import type { ArtifactData } from "./artifact";
import { sourcePoint, viewportPoint } from "./coordinates";

export type PdfViewerProps = {
  readonly compact?: boolean;
  readonly data: ArtifactData;
  readonly browser: boolean;
  readonly location: PdfLocation | null;
  readonly onReverse?: (location: PdfLocation) => Promise<void>;
  readonly onError: (error: Error) => void;
};
export function PdfViewer({ data, browser, location, onReverse, onError, compact = false }: PdfViewerProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(0);
  const [text, setText] = useState("");
  const [rendered, setRendered] = useState(false);
  const [marker, setMarker] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const viewport = useRef<PageViewport | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => {
    let active = true;
    setPdf(null); setPage(1); setRendered(false);
    GlobalWorkerOptions.workerSrc = new URL(
      "../../../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url,
    ).href;
    const task = getDocument({ data: new Uint8Array(data.bytes) });
    void task.promise.then(document => {
      if (active) setPdf(document);
    }).catch(error => {
      if (!(error instanceof Error)) throw error;
      if (active) report.current(error);
    });
    return () => { active = false; void task.destroy(); };
  }, [data]);
  useEffect(() => {
    const node = body.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [browser]);
  useEffect(() => {
    if (location) { setPage(location.page); setZoom("fit"); }
  }, [location]);
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!pdf || !node || width <= 0 || browser) return undefined;
    let active = true;
    let render: RenderTask | undefined;
    setRendered(false); setMarker(null);
    void pdf.getPage(Math.max(1, Math.min(pdf.numPages, page))).then(async entry => {
      if (!active) return;
      const original = entry.getViewport({ scale: 1 });
      const scale = zoom === "fit" ? Math.min(1.5, width / original.width) : zoom;
      const view = entry.getViewport({ scale });
      viewport.current = view;
      const ratio = window.devicePixelRatio;
      node.width = Math.ceil(view.width * ratio);
      node.height = Math.ceil(view.height * ratio);
      node.style.width = `${view.width}px`;
      node.style.height = `${view.height}px`;
      render = entry.render({ canvas: node, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0] });
      const content = await entry.getTextContent();
      if (active) setText(content.items.flatMap(item => "str" in item ? [item.str] : []).join(" "));
      await render.promise;
      if (active) {
        setRendered(true);
        if (location?.page === page) setMarker(viewportPoint(view, location));
      }
    }).catch(error => {
      if (!(error instanceof Error)) throw error;
      if (active) report.current(error);
    });
    return () => { active = false; render?.cancel(); };
  }, [pdf, page, zoom, width, browser, location]);
  const reverse = (x: number, y: number) => {
    if (!viewport.current || !onReverse) return;
    void onReverse({ page, ...sourcePoint(viewport.current, { x, y }) }).catch(error => {
      if (!(error instanceof Error)) throw error;
      report.current(error);
    });
  };
  return <div className="q-pdf-viewer" ref={root} data-artifact-id={data.id}>
    <div className="q-pdf-toolbar" role="group" aria-label="PDF navigation">
      <Button aria-label="Previous" title="Previous page" className={compact ? "q-pdf-icon-control" : undefined}
        disabled={!pdf || page <= 1} onClick={() => setPage(page - 1)}>{compact ? <Icon name="arrowLeft" /> : "Previous"}</Button>
      <Field label={compact ? <span className="q-sr-only">Page</span> : "Page"} type="number" min={1} max={pdf?.numPages ?? 1} value={page}
        onChange={event => setPage(Math.max(1, Math.min(pdf?.numPages ?? 1, Number(event.target.value))))} />
      <span aria-live="polite">of {pdf?.numPages ?? "…"}</span>
      <Button aria-label="Next" title="Next page" className={compact ? "q-pdf-icon-control" : undefined}
        disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(page + 1)}>{compact ? <Icon name="chevronRight" /> : "Next"}</Button>
      <label><span className={compact ? "q-sr-only" : undefined}>Zoom</span> <select aria-label="Zoom" value={zoom} disabled={browser} onChange={event =>
        setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value))}>
        <option value="fit">Fit width</option>
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value * 100}%</option>)}
      </select></label>
      <Button aria-label="Presentation" title="Presentation" onClick={() => {
        const action = document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen();
        void action?.catch(error => { if (error instanceof Error) report.current(error); else throw error; });
      }}>{compact ? "View" : "Presentation"}</Button>
      <a className={`q-button q-button--neutral q-button--regular${compact ? " q-pdf-icon-control" : ""}`}
        aria-label={data.name.startsWith("diff-") ? "Download diff PDF" : "Download PDF"}
        title={data.name.startsWith("diff-") ? "Download diff PDF" : "Download PDF"} href={data.url} download={data.name}>
        {compact ? <Icon name="download" /> : data.name.startsWith("diff-") ? "Download diff PDF" : "Download PDF"}</a>
    </div>
    {browser ? <iframe className="q-pdf-native" title="Browser PDF viewer" src={`${data.url}#page=${page}`} /> :
      <div ref={body} className="q-pdf-body q-pdf-paper-region" aria-label="Rendered PDF">
        {!rendered && <p role="status">Rendering PDF page…</p>}
        <div className="q-pdf-page">
          <canvas ref={canvas} aria-label={`PDF page ${page}`} tabIndex={0}
            data-rendered={rendered} onDoubleClick={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              reverse(event.clientX - bounds.left, event.clientY - bounds.top);
            }} onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); reverse(0, 0); }
            }} />
          {marker && <span className="q-pdf-marker" aria-label="Source location"
            style={{ left: marker.x, top: marker.y }} />}
        </div>
        <p className="q-sr-only">{text}</p>
        {onReverse && <p>Double-click the PDF to reveal source. Keyboard: focus the page and press Enter to reveal its start.</p>}
      </div>}
  </div>;
}
