import { useEffect, useState } from "react";
import { z } from "zod";
import { IdSchema, assertNever, endpoints } from "@quire/contracts";
import type { Environment, GitStatus, Id } from "@quire/contracts";
import { BrandMark, Button, Modal } from "../../ui";
import { editorValue } from "./shared";
import type { CompileState, DocumentSnapshot, EditorClient, EditorDocument, EditorLayout, EditorRoute, EditorWorkspace, SourceLocation } from "./shared";
import type { ToolPanel } from "./tools";
import type { EditorSessionReady, RetainedSource } from "./session-controller";
import type { SourceCommand, SourceToolsHandle } from "./source";
import type { SourceTool } from "./shared";

export type EditorChromeActions = {
  readonly navigate: (page: EditorRoute["page"]) => void;
  readonly projects: () => void;
  readonly layout: (layout: EditorLayout) => void;
  readonly tool: (tool: ToolPanel) => void;
  readonly assistant: () => void;
  readonly share: () => void;
  readonly chat: () => void;
  readonly join: () => void;
  readonly compile: () => void;
  readonly cancel: () => void;
  readonly sourceToPdf: () => void;
};
export type EditorChromeModel = {
  readonly session: EditorSessionReady;
  readonly page: EditorRoute["page"];
  readonly layout: EditorLayout;
  readonly tool: ToolPanel;
  readonly toolsOpen: boolean;
  readonly assistantOpen: boolean;
  readonly snapshot: DocumentSnapshot | null;
  readonly compilation: CompileState;
  readonly location: SourceLocation | null;
  readonly compilerAvailable: boolean;
  readonly working: boolean;
  readonly sourceTracking?: boolean;
};
type Metadata = { readonly git: GitStatus | null; readonly environment: Environment | null; readonly error: string | null };
const emptyMetadata: Metadata = { git: null, environment: null, error: null };
export function useEditorMetadata(client: EditorClient, workspace: EditorWorkspace | null): Metadata {
  const [value, setValue] = useState<Metadata>(emptyMetadata);
  useEffect(() => {
    if (!workspace) return undefined;
    const abort = new AbortController();
    setValue(emptyMetadata);
    void Promise.all([
      client.call(endpoints.gitStatus, { params: { p: workspace.scope.projectId },
        query: { branch: workspace.scope.branch }, body: undefined, headers: workspace.requestHeaders }, abort.signal),
      client.call(endpoints.environmentsList, { params: {}, query: {}, body: undefined }, abort.signal),
    ]).then(([git, environments]) => {
      if (!abort.signal.aborted) setValue({ git: editorValue(git),
        environment: editorValue(environments).find(entry => entry.id === workspace.project.settings.environmentId) ?? null, error: null });
    }).catch((cause: unknown) => {
      if (abort.signal.aborted) return;
      if (cause instanceof Error) setValue({ ...emptyMetadata, error: cause.message });
      else throw cause;
    });
    return () => abort.abort();
  }, [client, workspace]);
  return value;
}
type GlyphName = "file" | "search" | "git" | "review" | "history" | "assistant" | "settings" | "play";
/** Paths transcribed from the supplied 01-editor source, with token-driven ink. */
function Glyph({ name, small = false }: { readonly name: GlyphName; readonly small?: boolean }) {
  let paths;
  switch (name) {
    case "file": paths = <><path d="M5 2.5h6l4 4v11H5z" /><path d="M11 2.5v4h4" /></>; break;
    case "search": paths = <><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></>; break;
    case "git": paths = <><circle cx="6" cy="4.5" r="2" /><circle cx="6" cy="15.5" r="2" /><circle cx="14" cy="6.5" r="2" /><path d="M6 6.5v7M14 8.5c0 4-8 2.5-8 5" /></>; break;
    case "review": paths = <path d="M3 4h14v10H8l-4 3v-3H3z" />; break;
    case "history": paths = <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l3 2" /></>; break;
    case "assistant": paths = <><path d="M10 2.5l1.7 4.8 4.8 1.7-4.8 1.7L10 15.5l-1.7-4.8L3.5 9l4.8-1.7z" /><path d="M15.5 13.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" /></>; break;
    case "settings": paths = <><path d="M3 6h9M15 6h2M3 14h3M9 14h8" /><circle cx="13.5" cy="6" r="1.8" /><circle cx="7.5" cy="14" r="1.8" /></>; break;
    case "play": paths = <path d="M6 4l10 6-10 6z" fill="currentColor" stroke="none" />; break;
    default: return assertNever(name);
  }
  return <svg width={small ? 16 : 20} height={small ? 16 : 20} viewBox="0 0 20 20"
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}
const PeerSchema = z.object({ user: z.object({ id: IdSchema, name: z.string() }) });
function usePeers(document: EditorDocument | null, self: { readonly id: Id | null; readonly name: string | null }) {
  const [peers, setPeers] = useState<readonly { readonly id: Id; readonly name: string }[]>([]);
  useEffect(() => {
    const update = () => {
      const names = new Map<Id, string>();
      if (self.id && self.name) names.set(self.id, self.name);
      for (const state of document?.awareness.getStates().values() ?? []) {
        const parsed = PeerSchema.safeParse(state);
        if (parsed.success) names.set(parsed.data.user.id, parsed.data.user.name);
      }
      const next = [...names].map(([id, name]) => ({ id, name }));
      setPeers(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    update();
    document?.awareness.on("change", update);
    return () => { document?.awareness.off("change", update); };
  }, [document, self.id, self.name]);
  return peers;
}
const pageLabels = { edit: "Editor", git: "Git", agent: "Assistant", history: "History", review: "Review", logs: "Compile logs", "pdf-diff": "PDF comparison" } as const;
const pageOrder = ["edit", "git", "agent", "history", "review", "logs", "pdf-diff"] as const;
const sourceTools: readonly { readonly tool: SourceTool; readonly label: string }[] = [
  { tool: "find", label: "Find and replace" }, { tool: "outline", label: "Outline" },
  { tool: "check", label: "Code Check" }, { tool: "preferences", label: "Source preferences" },
  { tool: "shortcuts", label: "Keyboard shortcuts" },
];
const sourceFormats: readonly { readonly command: SourceCommand; readonly label: string }[] = [
  { command: "bold", label: "Bold" }, { command: "italic", label: "Italic" },
  { command: "inline-math", label: "Inline math" }, { command: "display-math", label: "Display math" },
  { command: "comment", label: "Toggle comment" }, { command: "complete", label: "Completion" },
  { command: "line", label: "Go to line" },
];
export function EditorSourceChrome({ document, tools, readOnly }: {
  readonly document: EditorDocument; readonly tools: SourceToolsHandle | null; readonly readOnly: boolean;
}) {
  return <header className="qe-source-header"><strong title={document.file.path}>{document.file.path}</strong>
    <details className="qe-project-menu" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
    }}><summary className="q-button" aria-label="Source actions">Source actions</summary><nav aria-label="Source actions">
      {sourceTools.map(({ tool, label }) => <Button size="small" variant="ghost" key={tool} disabled={!tools} onClick={event => {
        event.currentTarget.closest("details")?.removeAttribute("open"); tools?.open(tool);
      }}>{label}</Button>)}
      <hr />
      {sourceFormats.map(({ command, label }) => <Button size="small" variant="ghost" key={command}
        disabled={!tools || (tools.readOnly ?? readOnly) && command !== "complete" && command !== "line"} onClick={event => {
          event.currentTarget.closest("details")?.removeAttribute("open"); tools?.format(command);
        }}>{label}</Button>)}
    </nav></details>
  </header>;
}
type ChromeProps = { readonly model: EditorChromeModel; readonly actions: EditorChromeActions; readonly metadata: Metadata };
export function EditorHeader({ model, actions, metadata }: ChromeProps) {
  const { workspace, document, userId, userName } = model.session;
  const peers = usePeers(document, { id: userId, name: userName });
  const pending = model.compilation.job?.status === "queued" || model.compilation.job?.status === "running";
  const persistence = model.snapshot?.persistence;
  const blocked = persistence?.kind === "offline" || persistence?.kind === "recovery" || persistence?.kind === "closed";
  useEffect(() => { window.document.title = `${pageLabels[model.page]} | ${workspace.project.name} | Quire`; }, [model.page, workspace.project.name]);
  return <header className="q-header qe-project-header"><BrandMark /><h1 className="q-sr-only">{pageLabels[model.page]}</h1>
    <nav className="qe-breadcrumb" aria-label="Breadcrumb"><Button variant="ghost" onClick={actions.projects}>Projects</Button><span aria-hidden="true">/</span><strong className="qe-title">{workspace.project.name}</strong>{model.page !== "edit" && <><span aria-hidden="true">/</span><strong>{pageLabels[model.page]}</strong></>}</nav>
    {model.page === "edit" && <div className="qe-modes" role="group" aria-label="Workspace layout">
      {(["source", "split", "visual", "pdf", "stacked"] as const).map(mode => <Button size="small" variant="ghost" key={mode} aria-pressed={model.layout === mode} onClick={() => actions.layout(mode)}>{mode === "stacked" ? "Vertical" : mode === "pdf" ? "PDF" : mode.slice(0, 1).toUpperCase() + mode.slice(1)}</Button>)}
    </div>}
    {workspace.access.capabilities.join && <Button variant="primary" disabled={model.working || blocked} onClick={actions.join}>Join project to edit</Button>}
    {["edit", "review", "logs"].includes(model.page) && <Button variant={pending || workspace.access.capabilities.join ? "neutral" : "primary"} title={pending ? "Cancel compilation" : "Recompile (Ctrl/Cmd+Enter)"} disabled={!model.compilerAvailable || !workspace.access.capabilities.compile || blocked || model.working}
      onClick={pending ? actions.cancel : actions.compile}><Glyph name="play" small />{pending ? "Cancel compile" : "Recompile"}</Button>}
    <Button className="qe-branch" onClick={() => actions.navigate("git")}><Glyph name="git" small />{workspace.scope.branch}{metadata.git?.upstream && ` ↑${metadata.git.ahead} ↓${metadata.git.behind}`}</Button>
    {peers.length > 0 && <div className="qe-avatars" aria-label={`${peers.length} connected collaborators`}>{peers.slice(0, 2).map((peer, index) =>
      <button type="button" key={peer.id} className={`qe-avatar qe-avatar--${index}`} aria-label={peer.name} title={peer.name} onClick={actions.share}>{peer.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.slice(0, 1)).join("")}</button>)}
      {peers.length > 2 && <Button size="small" title="Connected collaborators" onClick={actions.share}>+{peers.length - 2}</Button>}</div>}
    {model.page === "edit" && <Button aria-pressed={model.assistantOpen} onClick={actions.assistant}><Glyph name="assistant" small />Assistant</Button>}
    <Button onClick={actions.share}>Share</Button>
    {model.page !== "edit" && <Button onClick={() => actions.navigate("edit")}>Back to editor</Button>}
    <details className="qe-project-menu" onKeyDown={event => {
      if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
    }}><summary className="q-button">Workspace</summary><nav aria-label="Project views">
      {pageOrder.map(page =>
        <Button key={page} variant="ghost" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); actions.navigate(page); }}>{pageLabels[page]}</Button>)}
      <Button variant="ghost" disabled={!workspace.access.capabilities.chat} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); actions.chat(); }}>Project chat</Button>
    </nav></details>
  </header>;
}
export function EditorRail({ model, actions, metadata }: ChromeProps) {
  return <>
    <Button className="qe-rail-button" variant="ghost" aria-label="Files" title="Files" aria-pressed={model.toolsOpen && model.tool === "files"} onClick={() => actions.tool("files")}><Glyph name="file" /></Button>
    <Button className="qe-rail-button" variant="ghost" aria-label="Project search" title="Project search" aria-pressed={model.toolsOpen && model.tool === "search"} onClick={() => actions.tool("search")}><Glyph name="search" /></Button>
    <Button className="qe-rail-button" variant="ghost" aria-label="Git" title="Git" onClick={() => actions.navigate("git")}><Glyph name="git" />{!!metadata.git?.files.length && <span className="qe-count">{metadata.git.files.length}</span>}</Button>
    <Button className="qe-rail-button" variant="ghost" aria-label="Review" title="Review" onClick={() => actions.navigate("review")}><Glyph name="review" /></Button>
    <Button className="qe-rail-button" variant="ghost" aria-label="History" title="History" onClick={() => actions.navigate("history")}><Glyph name="history" /></Button>
    <Button className="qe-rail-button qe-sigma" variant="ghost" aria-label="Symbols" title="Symbols" onClick={() => actions.tool("symbols")}>Σ</Button>
    <Button className="qe-rail-button" variant="ghost" aria-label="Assistant" title="Assistant" onClick={actions.assistant}><Glyph name="assistant" /></Button>
    <Button className="qe-rail-button qe-settings" variant="ghost" aria-label="Project settings" title="Project settings" onClick={() => actions.tool("settings")}><Glyph name="settings" /></Button>
  </>;
}
export function EditorStatus({ model, actions, metadata }: ChromeProps) {
  const { snapshot, compilation, location } = model;
  const job = compilation.job;
  let compileLabel = "Not compiled";
  const status = job?.status;
  if (job) switch (job.status) {
    case "queued": compileLabel = "Compile queued"; break;
    case "running": compileLabel = "Compiling"; break;
    case "succeeded": compileLabel = job.elapsedMs === null ? "Compiled" : `Compiled in ${(job.elapsedMs / 1000).toFixed(2)} s`; break;
    case "failed": compileLabel = "Compile failed"; break;
    case "timeout": compileLabel = "Compile timed out"; break;
    case "canceled": compileLabel = "Compile canceled"; break;
    default: compileLabel = assertNever(job.status);
  }
  const engines = { pdflatex: "pdfLaTeX", latex: "LaTeX", xelatex: "XeLaTeX", lualatex: "LuaLaTeX", plain: "Plain TeX" } as const;
  return <>
    <span className={`qe-compile-status qe-compile-status--${status ?? "none"}`}>{compileLabel}</span>
    <span data-environment-state={metadata.environment ? "ready" : metadata.error ? "error" : "loading"}>{engines[model.session.workspace.project.settings.engine]} · {metadata.environment?.label ?? (metadata.error ? "Environment unavailable" : "Loading environment")}</span>
    <Button size="small" variant="ghost" onClick={() => actions.navigate("logs")}>{job ? `${job.diagnostics.length} diagnostics` : "Compile logs"}</Button>
    <span className="qe-status-spacer" />
    {location && <Button size="small" variant="ghost" disabled={!compilation.preview} onClick={actions.sourceToPdf} title="Jump from source to PDF">Ln {location.line}, Col {location.column}</Button>}
    <span>UTF-8</span>
    <span role="status" aria-live="polite" data-save-state={snapshot?.persistence.kind} data-save-revision={snapshot?.persistence.kind === "saved" ? snapshot.persistence.revision : undefined}>
      {snapshot?.persistence.kind === "saved" ? model.sourceTracking ? "Shared source saved · tracking on" : "Shared source saved" : snapshot?.readOnlyReason ?? (snapshot?.persistence.kind === "saving" ? "Saving changes" : "Opening source")}</span>
    {metadata.error && <span role="alert">{metadata.error}</span>}
  </>;
}
export function EditorRecovery({ retained, discard, copy }: {
  readonly retained: readonly RetainedSource[];
  readonly discard: (key: string) => void;
  readonly copy: (text: string) => void;
}) {
  const [selected, setSelected] = useState<RetainedSource | null>(null);
  return <>{retained.map(entry => <details className="qe-message" key={entry.key}>
    <summary>Unsaved local source retained: {entry.file.path}</summary>
    <textarea aria-label={`Retained source: ${entry.file.path}`} readOnly value={entry.text} />
    <Button onClick={() => copy(entry.text)}>Copy retained source</Button>
    <Button variant="danger" onClick={() => setSelected(entry)}>Discard recovery copy…</Button>
  </details>)}{selected && <Modal open title="Discard recovery copy?" onClose={() => setSelected(null)}
    footer={<><Button onClick={() => setSelected(null)}>Cancel</Button><Button variant="danger" onClick={() => { discard(selected.key); setSelected(null); }}>Discard copy</Button></>}>
    <p>This removes the retained local text for {selected.file.path}. Copy it first if you still need it.</p>
  </Modal>}</>;
}
