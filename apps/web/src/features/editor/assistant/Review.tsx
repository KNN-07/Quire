import { useState } from "react";
import { BranchSchema, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { Button } from "../../../ui";
import { editorValue } from "../shared";
import type { AssistantState } from "./use-assistant";

export function AssistantReview({ state }: { readonly state: AssistantState }) {
  const [commit, setCommit] = useState(false);
  const [branch, setBranch] = useState("");
  const edits = state.run?.proposals.flatMap(proposal => proposal.edits) ?? [];
  const pending = edits.filter(edit => edit.status === "pending");
  const accepted = edits.filter(edit => edit.status === "accepted");
  const disabled = state.busy || !state.online || !state.workspace.access.capabilities.edit;
  async function decide(decision: "accept" | "reject" | "undo", editIds: readonly Id[]) {
    if (!state.run) return;
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
    <div className="qa-assistant__row"><h3>Review changes</h3><span>{pending.length} pending</span></div>
    <div className="qa-assistant__row">
      <Button disabled={disabled || !pending.length} onClick={() => void state.execute(() => decide("reject", pending.map(edit => edit.id)))}>Reject all</Button>
      <Button variant="ai" disabled={disabled || !pending.length} onClick={() => void state.execute(() => decide("accept", pending.map(edit => edit.id)))}>Accept all</Button>
      <Button disabled={disabled || !accepted.length} onClick={() => void state.execute(() => decide("undo", accepted.map(edit => edit.id)))}>Undo all</Button>
    </div>
    {edits.map(edit => {
      const file = state.workspace.files.find(item => item.id === edit.fileId);
      return <article className="qa-assistant__edit" key={edit.id} aria-label={`${file?.path ?? edit.fileId} proposal`}>
        <header className="qa-assistant__row"><code>{file?.path ?? edit.fileId}</code><strong>{edit.status}</strong></header>
        <div className="qa-assistant__before"><span>Before</span><pre>{edit.before || "(empty)"}</pre></div>
        <div className="qa-assistant__after"><span>After</span><pre>{edit.after || "(empty)"}</pre></div>
        <div className="qa-assistant__row qa-assistant__edit-actions">
          <Button disabled={disabled || edit.status !== "pending"} onClick={() => void state.execute(() => decide("reject", [edit.id]))}>Reject</Button>
          <Button disabled={disabled || edit.status !== "pending"} onClick={() => void state.execute(() => decide("accept", [edit.id]))}>Accept</Button>
          <Button disabled={disabled || edit.status !== "accepted"} onClick={() => void state.execute(() => decide("undo", [edit.id]))}>Undo</Button>
          <Button disabled={!file || !state.online || state.busy} onClick={() => void state.execute(() => state.navigation.openFile(edit.fileId))}>Open source</Button>
        </div>
        {edit.status === "conflict" && <p role="alert">This edit conflicts with current source. Regenerate; source remains unchanged.</p>}
      </article>;
    })}
    <details><summary>Git options</summary>
      <label className="qa-assistant__check"><input type="checkbox" checked={commit}
        onChange={event => setCommit(event.target.checked)} />Commit accepted changes</label>
      <label>New branch (optional, ai/ prefix)<input value={branch} placeholder="ai/revise-abstract"
        onChange={event => setBranch(event.target.value)} /></label>
      <p>Existing dirty source must be committed first. Branches and commits are created only on acceptance.</p>
    </details>
    {state.run?.tool === "error-fix" && accepted.length > 0 && <Button disabled={disabled || !state.compile}
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
