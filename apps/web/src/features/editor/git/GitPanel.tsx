import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, Modal, Spinner } from "../../../ui";
import { ConflictPanel } from "./ConflictPanel";
import { DiffView } from "./DiffView";
import { cloneUrl, shortOid } from "./types";
import type { CompareTarget, DiffLayout, GitPanelProps } from "./types";
import { useGitWorkspace } from "./useGitWorkspace";
import "./git.css";

type MobilePanel = "changes" | "diff" | "history";

function expiresAt(): string {
  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function GitPanel(props: GitPanelProps) {
  const git = useGitWorkspace(props);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [layout, setLayout] = useState<DiffLayout>("unified");
  const [target, setTarget] = useState<CompareTarget>("working");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("changes");
  const [branchDialog, setBranchDialog] = useState(false);
  const [tokenDialog, setTokenDialog] = useState(false);
  const [mergeFrom, setMergeFrom] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [compileFirst, setCompileFirst] = useState(false);
  const compileRequired = props.preferences?.compileBeforeCommit === true;
  const status = git.status;
  const writable = props.workspace.access.capabilities.edit && online;
  const changedPath = selectedPath && status?.files.some(file => file.path === selectedPath)
    ? selectedPath : status?.files[0]?.path ?? null;
  const hunks = useMemo(() => status?.hunks.filter(hunk => hunk.path === changedPath) ?? [],
    [changedPath, status?.hunks]);
  const mergeBranches = git.branches.filter(branch => !branch.current);
  const gitConnections = git.connections.filter(connection =>
    ["git", "github", "gitlab"].includes(connection.provider));
  const remoteAvailability = git.availability["github"] ?? git.availability["gitlab"] ?? git.availability["git"];
  useEffect(() => {
    if (git.conflict) setMobilePanel("diff");
  }, [git.conflict]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (git.loading) return <div className="git-loading"><Spinner label="Loading Git workspace" /> Loading Git workspace…</div>;
  if (!status) return <div className="git-empty"><h2>Git workspace unavailable</h2>
    <p role="alert">{git.error || "The named branch could not be loaded."}</p>
    <Button onClick={() => { void git.reload(); }}>Retry</Button></div>;

  return <section className="git-workspace" data-mobile-panel={mobilePanel}>
    <nav className="git-mobile-tabs" aria-label="Git workspace panels">
      {(["changes", "diff", "history"] as const).map(panel =>
        <button type="button" key={panel} aria-pressed={mobilePanel === panel}
          onClick={() => setMobilePanel(panel)}>{panel[0]?.toUpperCase() + panel.slice(1)}</button>)}
    </nav>
    <aside className="git-sidebar" aria-label="Source control">
      {!writable && <div className="git-permission" role="note">
        {online ? "Viewer access: Git writes are disabled." : "Offline: reconnect before changing Git state."}
      </div>}
      <section className="git-section">
        <label className="git-label" htmlFor="git-branch">Branch</label>
        <div className="git-control-row"><select id="git-branch" value={status.branch}
          onChange={event => { void git.switchBranch(event.currentTarget.value); }}>
          {git.branches.map(branch => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
        </select><IconButton icon="plus" label="New branch" disabled={!writable} onClick={() => setBranchDialog(true)} /></div>
        <p>{status.upstream
          ? <>{status.ahead} ahead · {status.behind} behind <code>{status.upstream}</code></>
          : <>Default branch · <code>{shortOid(status.head)}</code></>}</p>
      </section>
      <section className="git-section">
        <div className="git-section__heading"><h2>Changes · {status.files.length}</h2>
          {status.hunks.length > 0 && <Button size="small" variant="ghost" disabled={!writable || git.busy}
            onClick={() => { void git.stage(status.hunks.map(hunk => hunk.id), status.staged.length !== status.hunks.length); }}>
            {status.staged.length === status.hunks.length ? "Unstage all" : "Stage all"}</Button>}</div>
        {status.files.length === 0 ? <p className="git-muted">Working tree clean.</p>
          : <ul className="git-files">{status.files.map(file => {
            const fileHunks = status.hunks.filter(hunk => hunk.path === file.path);
            const staged = fileHunks.length > 0 && fileHunks.every(hunk => hunk.staged);
            return <li key={file.path} className={file.path === changedPath ? "is-selected" : ""}>
              <div><input type="checkbox" checked={staged} disabled={!writable || git.busy}
                aria-label={`${staged ? "Unstage" : "Stage"} ${file.path}`}
                onChange={() => { void git.stage(fileHunks.map(hunk => hunk.id), !staged); }} />
                <button type="button" onClick={() => { setSelectedPath(file.path); setMobilePanel("diff"); }}>
                  <span>{file.path}</span><small>{file.status}</small>
                </button></div>
            </li>;
          })}</ul>}
      </section>
      <form className="git-commit" onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const message = form.get("message");
        void git.commit({
          message: typeof message === "string" ? message : "",
          compileFirst: compileRequired || compileFirst,
        });
      }}>
        <label className="git-label" htmlFor="git-message">Commit message</label>
        <textarea id="git-message" name="message" rows={4} required placeholder="Describe the staged source" />
        <label className="git-check"><input type="checkbox" name="compileFirst"
          checked={compileRequired || compileFirst} disabled={compileRequired}
          onChange={event => setCompileFirst(event.currentTarget.checked)} />Compile staged tree before commit</label>
        {compileRequired && <p className="git-muted">Required by your saved compile-before-commit preference.</p>}
        <Button type="submit" variant="primary" busy={git.busy}
          disabled={!writable || status.staged.length === 0}>Commit {status.staged.length} {status.staged.length === 1 ? "hunk" : "hunks"}</Button>
      </form>
      <section className="git-section">
        <h2>Remote</h2>
        {gitConnections.length === 0 ? <p className="git-muted">
          {remoteAvailability?.reason ?? "No configured Git remote."} <a href="/settings/git">Configure a connection</a>.
        </p>
          : gitConnections.map(connection => <div className="git-remote" key={connection.id}>
            <span><strong>{connection.label}</strong><small>{connection.provider} · {connection.state}</small></span>
            {connection.state === "ready" && <span>
              <Button size="small" disabled={!writable || git.busy}
                onClick={() => { void git.remoteAction({ id: connection.id,
                  action: connection.provider === "git" ? "fetch" : "pull", version: connection.version }); }}>
                {connection.provider === "git" ? "Fetch" : "Pull"}</Button>
              <Button size="small" disabled={!writable || git.busy}
                onClick={() => { void git.remoteAction({
                  id: connection.id, action: "push", version: connection.version,
                }); }}>Push</Button>
            </span>}
          </div>)}
      </section>
      <section className="git-clone">
        <h2>Clone with Git</h2>
        <label htmlFor="git-clone-url">HTTPS clone URL</label>
        <div className="git-control-row"><input id="git-clone-url" readOnly value={cloneUrl(props.workspace.scope.projectId)} />
          <Button size="small" onClick={() => { void navigator.clipboard.writeText(cloneUrl(props.workspace.scope.projectId)); }}>Copy</Button></div>
        <p>Username <code>git</code>. Use a personal Git token as the password.</p>
        <Button size="small" onClick={() => setTokenDialog(true)}>Create access token</Button>
      </section>
    </aside>
    {git.conflict ? <ConflictPanel conflict={git.conflict} busy={git.busy}
      onCancel={git.clearConflict} onResolve={resolutions => { void git.resolve(resolutions); }} />
      : <DiffView head={status.head} hunks={hunks} layout={layout} target={target}
        rendered={git.rendered} busy={git.busy} writable={writable}
        onLayout={setLayout} onTarget={setTarget}
        onStage={(ids, staged) => { void git.stage(ids, staged); }}
        onDiscard={ids => { void git.discard(ids); }}
        onCompare={() => { void git.compare(target); }}
        onRefreshRendered={() => { void git.refreshRendered(); }}
        onDownloadRendered={() => { void git.downloadRendered(); }} />}
    <aside className="git-history" aria-label="History and branches">
      <section><div className="git-section__heading"><h2>History</h2><Button size="small" variant="ghost" onClick={() => { void git.reload(); }}>Refresh</Button></div>
        <ol>{git.log.map(commit => <li key={commit.oid}><strong>{commit.message}</strong>
          <span>{commit.author} · {new Date(commit.at).toLocaleString()}</span><code>{shortOid(commit.oid)}</code></li>)}</ol></section>
      <section><h2>Branches</h2><ul>{git.branches.map(branch => <li key={branch.name}
        className={branch.current ? "is-current" : ""}><span><code>{branch.name}</code>
          <small>{branch.current ? "current" : `${branch.ahead} ahead · ${branch.behind} behind`}</small></span>
        {!branch.current && <Button size="small" onClick={() => { void git.switchBranch(branch.name); }}>Open</Button>}</li>)}</ul></section>
      <section className="git-merge"><h2>Merge branch</h2>
        <select value={mergeFrom} onChange={event => setMergeFrom(event.currentTarget.value)}>
          <option value="">Choose branch</option>{mergeBranches.map(branch =>
            <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select>
        <Button disabled={!writable || !mergeFrom || git.busy} onClick={() => { void git.merge(mergeFrom); }}>Merge into {status.branch}</Button>
      </section>
    </aside>
    {(git.error || git.message) && <div className={`git-notice ${git.error ? "is-error" : ""}`}
      role={git.error ? "alert" : "status"}>{git.error || git.message}</div>}
    <Modal open={branchDialog} onClose={() => setBranchDialog(false)} title="Create branch"
      footer={<Button onClick={() => setBranchDialog(false)}>Cancel</Button>}>
      <form id="git-branch-form" className="git-dialog-form" onSubmit={event => {
        event.preventDefault(); const name = new FormData(event.currentTarget).get("name");
        if (typeof name === "string") void git.createBranch(name).then(created => {
          if (created) setBranchDialog(false);
        });
      }}><label>Branch name<input name="name" required placeholder="draft/method-rewrite" /></label>
        <Button type="submit" variant="primary" busy={git.busy}>Create branch</Button></form>
    </Modal>
    <Modal open={tokenDialog} onClose={() => { setTokenDialog(false); git.clearToken(); }} title="Git access token">
      {git.tokenSecret ? <div className="git-token"><p>Copy this token now. It is returned once.</p>
        <output aria-label="New Git token">{git.tokenSecret}</output><Button onClick={() => { void navigator.clipboard.writeText(git.tokenSecret); }}>Copy token</Button></div>
        : <form className="git-dialog-form" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          const name = form.get("name"), expiry = form.get("expiry");
          if (typeof name === "string" && typeof expiry === "string") {
            void git.createToken({ name, expiresAt: new Date(expiry).toISOString() });
          }
        }}><label>Token name<input name="name" required defaultValue="Editor clone" /></label>
          <label>Expires at<input name="expiry" type="datetime-local" required defaultValue={expiresAt()} /></label>
          <Button type="submit" variant="primary" busy={git.busy}>Create token</Button></form>}
    </Modal>
  </section>;
}
