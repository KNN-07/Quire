import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AdminUserSummary, Organization } from "@quire/contracts";
import { Button, Field, Modal } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { TransferProject } from "./TransferProject";

type DialogProps = {
  readonly client: AdminClient;
  readonly onClose: () => void;
  readonly onComplete: (message: string) => void;
};
export function InviteUser({ client, onClose, onComplete }: DialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function invite() {
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.adminUserInvite, {
        params: {}, query: {}, body: { name, email }, headers: { "idempotency-key": requestKey },
      });
      if ("error" in result) setError(result.error.message);
      else onComplete(`Invitation created for ${result.data.primaryEmail}.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <Modal open title="Invite users" onClose={() => { if (!busy) onClose(); }}
    description="Invite someone to join this Quire instance."
    footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="invite-user" busy={busy}>Send invitation</Button></>}>
    <form id="invite-user" className="admin-form" onSubmit={event => { event.preventDefault(); void invite(); }}>
      <Field label="Full name" autoFocus required value={name} onChange={event => { setName(event.currentTarget.value); setRequestKey(crypto.randomUUID()); }} />
      <Field label="Email address" type="email" required value={email} onChange={event => { setEmail(event.currentTarget.value); setRequestKey(crypto.randomUUID()); }} />
      {error && <p role="alert">{error}</p>}
    </form>
  </Modal>;
}

export function ManageUser({ client, user, onClose, onComplete }: DialogProps & { readonly user: AdminUserSummary }) {
  const [name, setName] = useState(user.name);
  const [operator, setOperator] = useState(user.operator);
  const [suspended, setSuspended] = useState(user.suspended);
  const [organizations, setOrganizations] = useState<readonly Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void client.call(endpoints.organizationsList, { params: {}, query: { limit: 200 }, body: undefined }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if ("error" in result) setError(result.error.message);
      else setOrganizations(result.data.items);
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [client]);
  async function save() {
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.adminUserPatch, {
        params: { u: user.id }, query: {}, body: { name, operator, suspended, expectedVersion: user.version },
      });
      if ("error" in result) setError(result.error.message);
      else onComplete(`${result.data.name} updated.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.adminUserRevoke, {
        params: { u: user.id }, query: {}, body: { expectedVersion: user.version },
      });
      if ("error" in result) setError(result.error.message);
      else onComplete(`Sessions revoked for ${user.name}.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.adminUserRestore, {
        params: { u: user.id }, query: {}, body: { expectedVersion: user.version },
      });
      if ("error" in result) setError(result.error.message);
      else onComplete(`${user.name} restored.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function addGroup() {
    const organization = organizations.find(item => item.id === organizationId);
    if (!organization) return;
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.memberCreate, {
        params: { o: organization.id }, query: {},
        body: { userId: user.id, role: "member", licensed: false, expectedVersion: organization.version },
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      if ("error" in result) setError(result.error.message);
      else onComplete(`${user.name} added to ${organization.name}.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function removeGroup(group: AdminUserSummary["groups"][number]) {
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.memberDelete, {
        params: { o: group.membership.organizationId, id: group.membership.id }, query: {},
        body: { expectedVersion: group.membership.version },
      });
      if ("error" in result) setError(result.error.message);
      else onComplete(`${user.name} removed from ${group.name}.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <Modal open className="admin-template-dialog" title={`Manage ${user.name}`} description={user.primaryEmail}
    onClose={() => { if (!busy) onClose(); }}
    footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button>
      {user.deletedAt ? <Button variant="primary" busy={busy} onClick={() => void restore()}>Restore account</Button>
        : <Button variant="primary" type="submit" form="manage-user" busy={busy}>Save changes</Button>}</>}>
    <form id="manage-user" className="admin-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field label="Full name" required autoFocus value={name} disabled={Boolean(user.deletedAt)}
        onChange={event => setName(event.currentTarget.value)} />
      <label className="admin-check"><input type="checkbox" checked={operator} disabled={Boolean(user.deletedAt)}
        onChange={event => setOperator(event.currentTarget.checked)} />Instance operator</label>
      <label className="admin-check"><input type="checkbox" checked={suspended} disabled={Boolean(user.deletedAt)}
        onChange={event => setSuspended(event.currentTarget.checked)} />Suspend account access</label>
      {!user.deletedAt && <section aria-label="Group memberships">
        <h2>Groups</h2>
        {user.groups.length ? <ul className="admin-group-list">{user.groups.map(group => <li key={group.membership.id}>
          <span>{group.name} <small>{group.membership.role}</small></span>
          <Button size="small" disabled={busy} onClick={() => void removeGroup(group)}>Remove<span className="q-sr-only"> from {group.name}</span></Button>
        </li>)}</ul> : <p className="admin-muted">No group memberships.</p>}
        <div className="admin-row"><label className="admin-label admin-grow"><span>Add to group</span>
          <select value={organizationId} onChange={event => setOrganizationId(event.currentTarget.value)}>
            <option value="">Select a group</option>
            {organizations.filter(item => !user.groups.some(group => group.membership.organizationId === item.id))
              .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label><Button disabled={!organizationId || busy} onClick={() => void addGroup()}>Add member</Button></div>
      </section>}
      {!user.deletedAt && <section aria-label="Session access">
        {revoking ? <><p>Revoke all active sessions for {user.name}?</p><Button variant="danger" busy={busy} onClick={() => void revoke()}>Confirm revocation</Button>
          <Button disabled={busy} onClick={() => setRevoking(false)}>Keep sessions</Button></>
          : <Button disabled={busy} onClick={() => setRevoking(true)}>Revoke sessions</Button>}
      </section>}
      <TransferProject client={client} user={user} onComplete={onComplete} />
      {error && <p role="alert">{error}</p>}
    </form>
  </Modal>;
}
