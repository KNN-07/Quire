import { Button } from "../../../ui";
import type { GitHunk } from "@quire/contracts";
import type { CompareTarget, DiffLayout } from "./types";
import { shortOid } from "./types";

type Props = {
  readonly head: string;
  readonly hunks: readonly GitHunk[];
  readonly layout: DiffLayout;
  readonly target: CompareTarget;
  readonly rendered: {
    readonly operation: { readonly status: string; readonly errorCode: string | null };
    readonly previewUrl: string | null;
    readonly artifactId: string | null;
  } | null;
  readonly busy: boolean;
  readonly writable: boolean;
  readonly onLayout: (layout: DiffLayout) => void;
  readonly onTarget: (target: CompareTarget) => void;
  readonly onStage: (ids: readonly string[], staged: boolean) => void;
  readonly onDiscard: (ids: readonly string[]) => void;
  readonly onCompare: () => void;
  readonly onRefreshRendered: () => void;
  readonly onDownloadRendered: () => void;
};

function lines(value: string): readonly string[] {
  return value === "" ? [] : value.split("\n");
}

type HunkProps = {
  readonly hunk: GitHunk;
  readonly busy: boolean;
  readonly writable: boolean;
  readonly onStage: (ids: readonly string[], staged: boolean) => void;
  readonly onDiscard: (ids: readonly string[]) => void;
};

function HunkHeader(props: HunkProps) {
  return <div className="git-hunk__header"><span>
    @@ -{props.hunk.oldStart},{props.hunk.oldLines} +{props.hunk.newStart},{props.hunk.newLines} @@
  </span><span className="git-hunk__controls">
    <button type="button" disabled={!props.writable || props.busy}
      onClick={() => props.onDiscard([props.hunk.id])}>Discard hunk</button>
    <button type="button" disabled={!props.writable || props.busy}
      onClick={() => props.onStage([props.hunk.id], !props.hunk.staged)}>
      {props.hunk.staged ? "Unstage hunk" : "Stage hunk"}</button>
  </span></div>;
}

function UnifiedHunk(props: HunkProps) {
  const { hunk } = props;
  return <section className="git-hunk" data-hunk-id={hunk.id}>
    <HunkHeader {...props} />
    {lines(hunk.before).map((line, index) =>
      <div className="git-line git-line--delete" key={`delete-${index}`}><span>-</span><code>{line || " "}</code></div>)}
    {lines(hunk.after).map((line, index) =>
      <div className="git-line git-line--add" key={`add-${index}`}><span>+</span><code>{line || " "}</code></div>)}
  </section>;
}

function SplitHunk(props: HunkProps) {
  const { hunk } = props;
  const before = lines(hunk.before);
  const after = lines(hunk.after);
  const rows = Array.from({ length: Math.max(before.length, after.length) }, (_, index) => index);
  return <section className="git-hunk" data-hunk-id={hunk.id}>
    <HunkHeader {...props} />
    <div className="git-split">
      {rows.map(index => <div className="git-split__row" key={index}>
        <div className="git-line git-line--delete"><span>-</span><code>{before[index] ?? " "}</code></div>
        <div className="git-line git-line--add"><span>+</span><code>{after[index] ?? " "}</code></div>
      </div>)}
    </div>
  </section>;
}

export function DiffView(props: Props) {
  const selected = props.hunks;
  return <main className="git-diff" aria-label="Git comparison">
    <header className="git-diff__toolbar">
      <div><strong className={selected[0] ? undefined : "git-diff__none"}>{selected[0]?.path ?? "No changed file selected"}</strong>
        <span>Working tree vs HEAD ({shortOid(props.head)})</span></div>
      <label>Compare
        <select value={props.target} onChange={event => props.onTarget(event.currentTarget.value === "staged" ? "staged" : "working")}>
          <option value="working">Working tree</option>
          <option value="staged">Staged source</option>
        </select>
      </label>
      <div className="git-segments" role="group" aria-label="Diff layout">
        {(["unified", "split", "rendered"] as const).map(layout =>
          <button key={layout} type="button" aria-pressed={props.layout === layout}
            onClick={() => props.onLayout(layout)}>
            {layout === "rendered" ? "Rendered PDF" : layout[0]?.toUpperCase() + layout.slice(1)}
          </button>)}
      </div>
    </header>
    {props.layout === "rendered" ? <div className="git-rendered">
      {!props.rendered && <div className="git-empty"><h3>No rendered comparison yet</h3>
        <p>Compile the exact {props.target} snapshot against the current named HEAD.</p>
        <Button variant="primary" busy={props.busy} disabled={props.target === "staged" && !selected.some(hunk => hunk.staged)}
          onClick={props.onCompare}>Render comparison</Button></div>}
      {props.rendered && !props.rendered.previewUrl && <div className="git-empty">
        <h3>Rendered comparison {props.rendered.operation.status}</h3>
        <p>{props.rendered.operation.errorCode ?? "The compiler publishes the preview when both immutable snapshots finish."}</p>
        <Button busy={props.busy} onClick={props.onRefreshRendered}>Check result</Button>
      </div>}
      {props.rendered?.previewUrl && <figure><img src={props.rendered.previewUrl} alt="Rendered PDF comparison preview" />
        <figcaption><Button onClick={props.onDownloadRendered}>Download comparison PDF</Button></figcaption></figure>}
    </div> : <div className="git-diff__scroll">
      {selected.length === 0 ? <div className="git-empty"><h3>No source differences</h3><p>The working tree matches the named branch.</p></div>
        : selected.map(hunk => props.layout === "split"
          ? <SplitHunk key={hunk.id} hunk={hunk} busy={props.busy} writable={props.writable}
            onStage={props.onStage} onDiscard={props.onDiscard} />
          : <UnifiedHunk key={hunk.id} hunk={hunk} busy={props.busy} writable={props.writable}
            onStage={props.onStage} onDiscard={props.onDiscard} />)}
    </div>}
    {props.layout !== "rendered" && selected.length > 0 && <footer className="git-diff__actions">
      <span>{selected.length} {selected.length === 1 ? "hunk" : "hunks"}</span>
      <Button disabled={!props.writable || props.busy} onClick={() => props.onDiscard(selected.map(hunk => hunk.id))}>Discard</Button>
      {selected.every(hunk => hunk.staged)
        ? <Button disabled={!props.writable || props.busy} onClick={() => props.onStage(selected.map(hunk => hunk.id), false)}>Unstage</Button>
        : <Button disabled={!props.writable || props.busy} onClick={() => props.onStage(selected.map(hunk => hunk.id), true)}>Stage</Button>}
    </footer>}
  </main>;
}
