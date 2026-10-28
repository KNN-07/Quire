import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { z } from "zod";
import { assertNever } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { Button, Modal } from "../../ui";
import type { EditorLayout, EditorRoute, EditorSlots } from "./shared";
import "./workspace.css";

const SizesSchema = z.object({
  tree: z.number().min(180).max(280),
  assistant: z.number().min(280).max(380),
  review: z.number().min(280).max(380),
  split: z.number().min(25).max(75),
  stacked: z.number().min(25).max(75),
}).readonly();
type Sizes = z.infer<typeof SizesSchema>;
type ResizeTarget = keyof Sizes;
const defaults: Sizes = { tree: 236, assistant: 320, review: 340, split: 50, stacked: 50 };
function savedSizes(key: string | null): Sizes {
  const value = key ? localStorage.getItem(key) : null;
  if (!value) return defaults;
  try {
    const parsed = SizesSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : defaults;
  } catch (cause) {
    if (cause instanceof SyntaxError) return defaults;
    throw cause;
  }
}
function useBreakpoint(query: string): boolean {
  const media = useMemo(() => matchMedia(query), [query]);
  const subscribe = useCallback((listener: () => void) => {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [media]);
  return useSyncExternalStore(subscribe, () => media.matches);
}
type SeparatorProps = {
  readonly target: ResizeTarget;
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly onResize: (target: ResizeTarget, value: number) => void;
  readonly onPointerResize: (target: ResizeTarget, event: PointerEvent<HTMLDivElement>) => void;
};
function Separator(props: SeparatorProps) {
  const horizontal = props.target === "stacked";
  const label = props.target === "split" || horizontal ? "source and PDF" : props.target;
  return <div className={`qe-separator qe-separator--${props.target}`} role="separator" tabIndex={0}
    aria-label={`Resize ${label}`} title={`Resize ${label}`}
    aria-orientation={horizontal ? "horizontal" : "vertical"}
    aria-valuemin={props.minimum} aria-valuemax={props.maximum} aria-valuenow={Math.round(props.value)}
    aria-valuetext={`${Math.round(props.value)} ${props.target === "split" || horizontal ? "percent" : "pixels"}`}
    onKeyDown={event => {
      let value;
      switch (event.key) {
        case "ArrowLeft": case "ArrowUp": value = props.value - 2; break;
        case "ArrowRight": case "ArrowDown": value = props.value + 2; break;
        case "Home": value = props.minimum; break;
        case "End": value = props.maximum; break;
        default: return;
      }
      event.preventDefault();
      props.onResize(props.target, value);
    }}
    onPointerDown={event => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      props.onPointerResize(props.target, event);
    }}
    onPointerMove={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) props.onPointerResize(props.target, event);
    }}
    onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />;
}
export type WorkspaceProps = {
  readonly slots: EditorSlots;
  readonly rail: ReactNode;
  readonly layout: EditorLayout;
  readonly page: EditorRoute["page"];
  readonly userId: Id | null;
  readonly toolsOpen: boolean;
  readonly onToolsOpenChange: (open: boolean) => void;
  readonly assistantOpen: boolean;
  readonly onAssistantOpenChange: (open: boolean) => void;
};
type WorkspaceStyle = CSSProperties & {
  readonly "--qe-tree": string;
  readonly "--qe-assistant": string;
  readonly "--qe-review": string;
  readonly "--qe-split": string;
  readonly "--qe-stacked": string;
};
/** Geometry only: producers retain their real controls and named scroll owners. */
export function EditorWorkspaceFrame(props: WorkspaceProps) {
  const { slots, page, layout } = props;
  const compact = useBreakpoint("(max-width: 1023px)");
  const narrow = useBreakpoint("(max-width: 767px)");
  const assistantDrawer = useBreakpoint("(max-width: 1279px)");
  const key = props.userId ? `quire.editor.sizes.${props.userId}` : null;
  const [sizes, setSizes] = useState(() => savedSizes(key));
  const [paneWidth, setPaneWidth] = useState(0);
  const [pane, setPane] = useState<"authoring" | "secondary">(layout === "pdf" ? "secondary" : "authoring");
  const panes = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { setSizes(savedSizes(key)); }, [key]);
  useEffect(() => {
    const node = panes.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) setPaneWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setPane(layout === "pdf" || page === "review" || page === "logs" || page === "pdf-diff" ? "secondary" : "authoring"); }, [layout, page]);
  const limits = (target: ResizeTarget): readonly [number, number] => {
    switch (target) {
      case "tree": return [180, 280];
      case "assistant": case "review": return [280, 380];
      case "stacked": return [25, 75];
      case "split": {
        const minimum = Math.max(25, Math.min(50, 340 / (paneWidth || 680) * 100));
        return [minimum, 100 - minimum];
      }
      default: return assertNever(target);
    }
  };
  const resize = (target: ResizeTarget, value: number) => {
    const [minimum, maximum] = limits(target);
    setSizes(current => {
      const next = { ...current, [target]: Math.min(maximum, Math.max(minimum, value)) };
      if (key) localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };
  const pointerResize = (target: ResizeTarget, event: PointerEvent<HTMLDivElement>) => {
    const area = target === "tree" || target === "assistant" ? body.current : panes.current;
    if (!area) return;
    const bounds = area.getBoundingClientRect();
    let value;
    switch (target) {
      case "tree": value = event.clientX - bounds.left - 52; break;
      case "assistant": case "review": value = bounds.right - event.clientX; break;
      case "split": value = (event.clientX - bounds.left) / bounds.width * 100; break;
      case "stacked": value = (event.clientY - bounds.top) / bounds.height * 100; break;
      default: assertNever(target);
    }
    resize(target, value);
  };
  const separator = (target: ResizeTarget) => {
    const [minimum, maximum] = limits(target);
    return <Separator target={target} value={Math.min(maximum, Math.max(minimum, sizes[target]))} minimum={minimum} maximum={maximum}
      onResize={resize} onPointerResize={pointerResize} />;
  };
  const paired = page === "edit" || page === "review" || page === "logs" || page === "pdf-diff";
  const showSource = page !== "pdf-diff" && (narrow ? pane === "authoring" : page !== "edit" || layout !== "pdf");
  const showSecondary = narrow ? pane === "secondary" : page !== "edit" || layout !== "source";
  const secondaryLabel = page === "review" ? "Review" : page === "logs" ? "Logs" : "PDF";
  const authoringLabel = layout === "visual" && page === "edit" ? "Visual" : "Source";
  let content;
  switch (page) {
    case "edit": case "review": case "logs": case "pdf-diff": content = null; break;
    case "git": content = slots.git; break;
    case "history": content = slots.review; break;
    case "agent": content = slots.assistant; break;
    default: content = assertNever(page);
  }
  const style: WorkspaceStyle = {
    "--qe-tree": `${sizes.tree}px`, "--qe-assistant": `${sizes.assistant}px`,
    "--qe-review": `${sizes.review}px`, "--qe-split": `${Math.min(limits("split")[1], Math.max(limits("split")[0], sizes.split))}%`, "--qe-stacked": `${sizes.stacked}%`,
  };
  const Main = page === "git" || page === "history" || page === "review" ? "div" : "main";
  return <div className="qe-workspace" style={style} data-page={page}>
    <div className="qe-header">{slots.header}</div>
    <div ref={body} className="qe-body" data-tools={page === "edit" && props.toolsOpen && !compact}
      data-assistant={page === "edit" && props.assistantOpen && !!slots.assistant && !assistantDrawer}>
      {page === "edit" && <nav className="qe-rail" aria-label="Editor panels">{props.rail}</nav>}
      {page === "edit" && !compact && props.toolsOpen && <aside className="qe-tools" aria-label="Project tools">
        {slots.tools}{separator("tree")}
      </aside>}
      <Main className="qe-main" aria-label="Editor workspace">
        <div ref={panes} className="qe-panes" data-layout={layout} data-page={page}
          data-source={showSource} data-secondary={showSecondary} hidden={!paired}>
          <section className="qe-authoring" aria-label={`${authoringLabel} workspace`} hidden={!showSource}>
            {authoringLabel === "Visual" ? slots.visual : slots.source}
          </section>
          {paired && showSource && showSecondary && separator(page === "review" ? "review" : layout === "stacked" ? "stacked" : "split")}
          <section className="qe-secondary" aria-label={`${secondaryLabel} workspace`} hidden={!showSecondary}>
            <div className="qe-pdf-owner" hidden={page === "review"}>{slots.pdf}</div>
            {page === "review" && slots.review}
          </section>
        </div>
        {!paired && <div className="qe-route">{content}</div>}
      </Main>
      {page === "edit" && !assistantDrawer && props.assistantOpen && slots.assistant &&
        <aside className="qe-assistant" aria-label="Assistant workspace">{separator("assistant")}{slots.assistant}</aside>}
    </div>
    {narrow && paired && page !== "pdf-diff" && <nav className="qe-mobile-tabs" aria-label="Workspace panes">
      {page === "edit" && <Button variant="ghost" onClick={() => props.onToolsOpenChange(true)}>Files</Button>}
      <Button variant="ghost" aria-pressed={pane === "authoring"} onClick={() => setPane("authoring")}>{authoringLabel}</Button>
      <Button variant="ghost" aria-pressed={pane === "secondary"} onClick={() => setPane("secondary")}>{secondaryLabel}</Button>
      {page === "edit" && slots.assistant &&
        <Button variant="ghost" onClick={() => props.onAssistantOpenChange(true)}>Assistant</Button>}
    </nav>}
    <footer className="qe-status">{slots.status}</footer>
    {compact && page === "edit" && <Modal open={props.toolsOpen && !props.assistantOpen} title="Project tools"
      className="qe-drawer" onClose={() => props.onToolsOpenChange(false)}>{slots.tools}</Modal>}
    {assistantDrawer && page === "edit" && props.assistantOpen && slots.assistant && <Modal open title="Assistant"
      className="qe-drawer" onClose={() => props.onAssistantOpenChange(false)}>{slots.assistant}</Modal>}
  </div>;
}
