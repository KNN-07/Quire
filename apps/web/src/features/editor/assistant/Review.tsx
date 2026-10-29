import { useState } from "react";
import { BranchSchema, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { Button, Icon } from "../../../ui";
import { editorValue } from "../shared";
import type { AssistantState } from "./use-assistant";

export function AssistantReview({ state }: { readonly state: AssistantState }) {
  const [commit, setCommit] = useState(false);
  const [branchOverride, setBranch] = useState<string | null>(null);
  const edits = state.run?.proposals.flatMap(proposal => proposal.edits) ?? [];
  const pending = edits.filter(edit => edit.status === "pending");
  const accepted = edits.filter(edit => edit.status === "accepted");
  const branch = branchOverride ?? (state.preferences?.aiBranch && state.run?.mode === "agent" && !accepted.length
    ? `ai/${state.run.id}` : "");
  const disabled = state.busy || !state.online || !state.workspace.access.capabilities.edit || state.tracking;
  async function decide(decision: "accept" | "reject" | "undo", editIds: readonly Id[]) {
    if (!state.run) return;
    if (state.tracking) throw new TypeError("Turn off Track changes before deciding Agent edits.");
    await state.document?.flush(state.signal);
    const latest = await state.readRun(state.run.id);
    const headers = { ...state.headers, "idempotency-key": crypto.randomUUID() };
    const next = decision === "undo"
      ? editorValue(await state.client.call(endpoints.aiRunUndo, {
        params: { id: latest.id }, query: {}, headers, body: { editIds: [...editIds], expectedVersion: latest.version },
      }, state.signal))
      : editorValue(await state.client.call(endpoints.aiRunDecide, {
        params: { id: latest.id }, query: {}, headers, body: {
          editIds: [...editIds], decision, expectedVersion: latest.version,
          ...(decision === "accept" ? { commit, ...(branch.trim() ? { newBranch: BranchSchema.parse(branch.trim()) } : {}) } : {}),
        },
      }, state.signal));
    state.updateRun(next);
    if (decision !== "reject") {
      if (next.scope.branch !== state.workspace.scope.branch) await state.navigation.changeBranch(next.scope.branch);
      await state.refreshWorkspace();
    }
    state.setNotice(next.proposals.some(proposal => proposal.edits.some(edit => edit.status === "conflict"))
      ? "Conflict: source was not changed. Reopen the source and regenerate from its current text."
      : `${decision === "undo" ? "Undone" : decision === "accept" ? "Accepted" : "Rejected"} ${editIds.length} edits`);
  }
  if (!edits.length) return null;
  return <section aria-label="Proposed changes" className="qa-assistant__review">
    <header className="qa-assistant__review-header">
      <Icon name="sparkle" /><h3>Review changes</h3><span>{pending.length} pending</span>
      <div className="qa-assistant__actions">
        <Button size="small" disabled={disabled || !pending.length} onClick={() => void state.execute(() => decide("reject", pending.map(edit => edit.id)))}>Reject all</Button>
        <Button size="small" variant="ai" disabled={disabled || !pending.length} onClick={() => void state.execute(() => decide("accept", pending.map(edit => edit.id)))}>Accept all</Button>
        {accepted.length > 0 && <Button size="small" disabled={disabled} onClick={() => void state.execute(() => decide("undo", accepted.map(edit => edit.id)))}>Undo all</Button>}
      </div>
    </header>
    <p className="qa-assistant__fine">Accept into {branch.trim() ? <>new branch <code>{branch.trim()}</code></> : <>current branch <code>{state.run?.scope.branch}</code></>}.
      {" "}Nothing is created or changed until you accept.</p>
    {state.tracking && <p className="qa-assistant__fine">Turn off Track changes before deciding Agent edits. Your proposal draft is retained.</p>}
    {edits.map(edit => {
      const file = state.workspace.files.find(item => item.id === edit.fileId);
      return <article className="qa-assistant__edit" key={edit.id} data-edit-status={edit.status} aria-label={`${file?.path ?? edit.fileId} proposal`}>
        <header><code>{file?.path ?? edit.fileId}</code>
          {edit.status !== "pending" && <strong className="qa-assistant__edit-status">{edit.status}</strong>}
        <div className="qa-assistant__actions qa-assistant__edit-actions">
          {edit.status === "pending" && <>
            <Button size="small" disabled={disabled} onClick={() => void state.execute(() => decide("reject", [edit.id]))}>Reject</Button>
            <Button size="small" variant="success" disabled={disabled} onClick={() => void state.execute(() => decide("accept", [edit.id]))}>Accept</Button>
          </>}
          {edit.status === "accepted" && <Button size="small" disabled={disabled} onClick={() => void state.execute(() => decide("undo", [edit.id]))}>Undo</Button>}
          <Button size="small" variant="ghost" disabled={!file || !state.online || state.busy} onClick={() => void state.execute(() => state.navigation.openFile(edit.fileId))}>Open source</Button>
        </div></header>
        <div className="qa-assistant__diff">
          {(edit.before || !edit.after) && <div className="qa-assistant__before"><span className="q-sr-only">Before</span><span aria-hidden="true">−</span><pre>{edit.before || "(empty)"}</pre></div>}
          {(edit.after || !edit.before) && <div className="qa-assistant__after"><span className="q-sr-only">After</span><span aria-hidden="true">+</span><pre>{edit.after || "(empty)"}</pre></div>}
        </div>
        {edit.status === "conflict" && <p role="alert" className="qa-assistant__fine qa-assistant__error">This edit conflicts with current source. Regenerate; source remains unchanged.</p>}
      </article>;
    })}
    <details open className="qa-assistant__git"><summary>Git options</summary>
      <label className="qa-assistant__check"><input type="checkbox" checked={commit}
        onChange={event => setCommit(event.target.checked)} />Commit accepted changes</label>
      <label>New branch (optional, ai/ prefix)<input value={branch} placeholder="ai/revise-abstract"
        onChange={event => setBranch(event.target.value)} /></label>
      <p className="qa-assistant__fine">Branches and commits are created only on acceptance; dirty source must be committed first.{" "}
        <Button size="small" variant="ghost" className="qa-assistant__link" disabled={disabled || !pending.length} onClick={() => setBranch("")}>Use current branch for this run</Button></p>
    </details>
    {state.run?.tool === "error-fix" && accepted.length > 0 && <Button variant="ai" disabled={disabled || !state.compile}
      onClick={() => void state.execute(async () => {
        if (!state.compile) return;
        await state.document?.flush(state.signal);
        const access = editorValue(await state.client.call(endpoints.projectAccess, {
          params: state.params, query: { branch: state.workspace.scope.branch }, body: undefined, headers: state.headers,
        }, state.signal));
        await state.compile.compile({ scope: state.workspace.scope, expectedRevision: access.branchRevision, clean: false });
        state.setNotice("Compilation requested for accepted source");
      })}>Recompile accepted fix</Button>}
  </section>;
}
