import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AdminUserSummary } from "@quire/contracts";
import { Button, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function TransferProject({ client, user, onComplete }: {
  readonly client: AdminClient; readonly user: AdminUserSummary; readonly onComplete: (message: string) => void;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [q, setQuery] = useState("");
  const [recipientCursor, setRecipientCursor] = useState<string | undefined>();
  const projects = useAdminResource(client, endpoints.adminProjects, { params: {}, query: { limit: 50, cursor }, body: undefined });
  const users = useAdminResource(client, endpoints.adminUsersList, {
    params: {}, query: { q, limit: 50, cursor: recipientCursor, state: "active", role: "all" }, body: undefined,
  });
  const [projectId, setProjectId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const project = projects.resource?.data.items.find(item => item.id === projectId && item.ownerId === user.id);
  const recipient = users.resource?.data.items.find(item => item.id === recipientId && item.id !== user.id);
  async function transfer() {
    if (!project || !recipient || !key) return;
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.adminUserTransfer, { params: { u: user.id }, query: {},
        body: { projectId: project.id, to: recipient.id, expectedVersion: user.version },
        headers: { "idempotency-key": key } });
      if ("error" in result) setError(result.error.message);
      else onComplete(`${project.name} transferred to ${recipient.name}.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-label="Project ownership"><h2>Transfer project</h2>
    {projects.error ? <p role="alert">{projects.error}</p> : projects.loading ? <Spinner label="Loading owned projects" /> : <>
      <label className="admin-label">Owned project<select value={projectId} onChange={event => setProjectId(event.currentTarget.value)}>
        <option value="">Choose a project</option>
        {projects.resource?.data.items.filter(item => item.ownerId === user.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className="admin-row">{cursor && <Button type="button" onClick={() => { setCursor(undefined); setProjectId(""); }}>First projects</Button>}
        {projects.resource?.data.nextCursor && <Button type="button" onClick={() => { setCursor(projects.resource?.data.nextCursor ?? undefined); setProjectId(""); }}>More projects</Button>}</div>
    </>}
    <Field label="Find new owner" value={q} onChange={event => { setQuery(event.currentTarget.value); setRecipientCursor(undefined); setRecipientId(""); }} />
    {users.error ? <p role="alert">{users.error}</p> : users.loading ? <Spinner label="Loading recipients" /> : <>
      <label className="admin-label">New owner<select value={recipientId} onChange={event => setRecipientId(event.currentTarget.value)}>
        <option value="">Choose a person</option>
        {users.resource?.data.items.filter(item => item.id !== user.id).map(item => <option key={item.id} value={item.id}>{item.name} ({item.primaryEmail})</option>)}
      </select></label>
      <div className="admin-row">{recipientCursor && <Button type="button" onClick={() => { setRecipientCursor(undefined); setRecipientId(""); }}>First people</Button>}
        {users.resource?.data.nextCursor && <Button type="button" onClick={() => { setRecipientCursor(users.resource?.data.nextCursor ?? undefined); setRecipientId(""); }}>More people</Button>}</div>
    </>}
    <Button disabled={!project || !recipient} onClick={() => { setKey(crypto.randomUUID()); setError(""); }}>Review transfer</Button>
    <Modal open={key !== null} title="Transfer project ownership" onClose={() => { if (!busy) setKey(null); }}
      footer={<><Button disabled={busy} onClick={() => setKey(null)}>Cancel</Button>
        <Button variant="danger" busy={busy} onClick={() => void transfer()}>Transfer project</Button></>}>
      <p>Transfer {project?.name} from {user.name} to {recipient?.name}?</p>
      <p>This changes the project's owner. The server checks current account and project eligibility.</p>
      {error && <p role="alert">{error}</p>}
    </Modal>
  </section>;
}
