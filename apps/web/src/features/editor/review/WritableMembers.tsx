import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Id, ResponseOf } from "@quire/contracts";
import { Button } from "../../../ui";
import type { EditorWorkspace, ReviewPanelProps } from "../shared";
import { errorMessage, PanelMessage } from "./common";
import "./benefits.css";

type Access = ResponseOf<typeof endpoints.accessGet>;

export function CurrentBenefits({ workspace }: { readonly workspace: EditorWorkspace }) {
  const { benefits, role, effectiveRole, capacityLimited } = workspace.access;
  return <section className="quire-benefits" aria-label="Current project benefits">
    <h3>Current project benefits</h3>
    <dl className="quire-benefits__values">
      <div><dt>Compile budget</dt><dd>{benefits.compileSeconds} seconds</dd></div>
      <div><dt>Writable collaborators</dt><dd>{benefits.writableMembers ?? "Unlimited"}</dd></div>
      <div><dt>History window</dt><dd>{benefits.historyDays === null ? "Unlimited" : `${benefits.historyDays} days`}</dd></div>
      <div><dt>Tracked proposals</dt><dd>{benefits.trackChanges ? "Allowed" : "Not available"}</dd></div>
    </dl>
    <p>Assigned role: {role}. Effective role: {effectiveRole}{capacityLimited ? " (read-only: writable capacity)" : ""}.</p>
  </section>;
}

export function WritableMembers({ props, access, version, reload }: {
  readonly props: ReviewPanelProps;
  readonly access: Access;
  readonly version: number;
  readonly reload: () => Promise<void>;
}) {
  const { client, workspace } = props;
  const [selected, setSelected] = useState<readonly Id[] | null>(access.writableSelection.memberIds);
  const [draftAccess, setDraftAccess] = useState(access);
  const [draftVersion, setDraftVersion] = useState(version);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failedVersion, setFailedVersion] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const signature = JSON.stringify([access.writableSelection, access.members.map(member =>
    [member.memberId, member.role, member.effectiveRole, member.capacityLimited])]);
  const stale = failedVersion || draftVersion !== version || JSON.stringify([
    draftAccess.writableSelection, draftAccess.members.map(member =>
      [member.memberId, member.role, member.effectiveRole, member.capacityLimited]),
  ]) !== signature;

  useEffect(() => {
    if (dirty) return;
    setSelected(access.writableSelection.memberIds);
    setDraftAccess(access); setDraftVersion(version);
  }, [access, version, dirty]);

  if (workspace.access.role !== "owner" || !workspace.access.capabilities.manageAccess) return null;
  const candidates = access.members.filter(member => member.memberId !== null
    && (member.role === "editor" || member.role === "reviewer"));
  const count = selected === null ? candidates.length : selected.length;
  const capacity = access.writableSelection.capacity;
  const overCapacity = capacity !== null && count > capacity;

  async function reloadCurrent() {
    setError(""); setSuccess(""); setDirty(false); setFailedVersion(false);
    setSelected(access.writableSelection.memberIds); setDraftAccess(access); setDraftVersion(version);
    try { await reload(); }
    catch (failure) { setError(errorMessage(failure)); }
  }
  async function save() {
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await client.call(endpoints.accessWritableMembersPut, {
        params: { p: workspace.scope.projectId }, query: {},
        body: { memberIds: selected === null ? null : [...selected], expectedVersion: draftVersion },
        headers: workspace.requestHeaders,
      });
      if ("error" in response) {
        setError(`${response.error.code}: ${response.error.message}`);
        setFailedVersion(response.error.code === "STALE_VERSION");
      } else {
        setDirty(false); await reload();
        setSuccess("Writable selection saved. Assigned roles and existing history are preserved.");
      }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="quire-benefits" aria-labelledby="writable-members-title"
    data-writable-version={version} data-selection-required={access.writableSelection.selectionRequired}>
    <h3 id="writable-members-title">Writable collaborators</h3>
    <p>{access.writableSelection.effectiveCount} effective · {capacity === null ? "Unlimited capacity" : `${capacity} writable ${capacity === 1 ? "place" : "places"}`}. Owners and Viewers do not use a place.</p>
    {access.writableSelection.selectionRequired && <PanelMessage tone="error">
      Selection required. Current assignments exceed capacity; no Editor or Reviewer is writable until the owner selects a group that fits.
    </PanelMessage>}
    <p>Unselected people keep their assigned roles and retained history and proposals. Their effective role is Viewer until selected again; current benefits still govern history access.</p>
    <form className="quire-benefits__form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>Selection mode<select value={selected === null ? "automatic" : "explicit"} disabled={busy || stale}
        onChange={event => {
          setSelected(event.currentTarget.value === "automatic" ? null : candidates.flatMap(member =>
            member.memberId === null ? [] : [member.memberId]));
          setDirty(true); setSuccess("");
        }}>
        <option value="automatic">Automatic (all assigned)</option>
        <option value="explicit">Choose collaborators</option>
      </select></label>
      <ul className="quire-benefits__members">
        {candidates.map(member => {
          const id = member.memberId;
          const candidate = id !== null && (member.role === "editor" || member.role === "reviewer");
          return <li key={member.user.id} data-benefit-member={member.user.id}>
            <label className="quire-benefits__member">
              <input type="checkbox" aria-label={`Writable access for ${member.user.name}`}
                checked={candidate && (selected === null || selected.includes(id))}
                disabled={!candidate || selected === null || busy || stale}
                onChange={event => {
                  if (id === null || selected === null) return;
                  setSelected(event.currentTarget.checked ? [...selected, id] : selected.filter(value => value !== id));
                  setDirty(true); setSuccess("");
                }} />
              <span><strong>{member.user.name}</strong><span>Assigned: {member.role} · Effective: {member.effectiveRole}</span>
                {member.capacityLimited && <span>Read-only: writable capacity. Assigned role preserved.</span>}
              </span>
            </label>
          </li>;
        })}
      </ul>
      {candidates.length === 0 && <p>No Editors or Reviewers are assigned. Invite a named collaborator above.</p>}
      <p>{count} selected{capacity === null ? "" : ` of ${capacity} places`}.
        {overCapacity ? " Deselect collaborators or increase the owner's benefits before saving." : ""}</p>
      {stale && <PanelMessage tone="error">Access changed while this selection was open. Reload access and review current roles and capacity before saving again.</PanelMessage>}
      <div className="quire-benefits__actions">
        <Button type="submit" busy={busy} disabled={!dirty || overCapacity || stale}>Save writable selection</Button>
        <Button disabled={busy} onClick={() => void reloadCurrent()}>Reload access</Button>
      </div>
    </form>
    {error && <PanelMessage tone="error">{error}</PanelMessage>}
    {success && <PanelMessage tone="success">{success}</PanelMessage>}
    <CurrentBenefits workspace={workspace} />
  </section>;
}
