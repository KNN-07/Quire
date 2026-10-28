import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AdminUserSummary } from "@quire/contracts";
import { Button, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function ProjectRecovery({ client, user, onComplete }: {
  readonly client: AdminClient; readonly user: AdminUserSummary; readonly onComplete: (message: string) => void;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const projects = useAdminResource(client, endpoints.adminDeletedProjects, {
    params: {}, query: { ownerId: user.id, cursor, limit: 20 }, body: undefined,
  });
  const [selectedId, setSelectedId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = projects.resource?.data.items.find(project => project.id === selectedId);
  const unavailable = Boolean(user.deletedAt) || user.suspended;
  async function restore() {
    if (!selected || !key) return;
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.adminProjectRestore, {
        params: { id: selected.id }, query: {},
        body: { confirmation, expectedVersion: selected.version }, headers: { "idempotency-key": key },
      });
      if ("error" in result) setError(result.error.message);
      else onComplete(`${result.data.name} restored. Revoked share links remain disabled.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-label="Deleted projects" className="admin-policy">
    <h2>Recover deleted projects</h2>
    <p className="admin-muted">Operator recovery restores retained source and history with existing membership. It does not reactivate old share links.</p>
    {unavailable && <p>Restore and enable this owner account before recovering its projects.</p>}
    {projects.error ? <p role="alert">{projects.error}</p> : projects.loading ? <Spinner label="Loading deleted projects" />
      : projects.resource?.data.items.length ? <>
        <label className="admin-label">Deleted project<select aria-label="Deleted project" value={selectedId} onChange={event => {
          setSelectedId(event.currentTarget.value); setConfirmation(""); setError("");
        }}>
          <option value="">Choose a deleted project</option>
          {projects.resource.data.items.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        {selected && <p>Deleted <time dateTime={selected.deletedAt}>{new Date(selected.deletedAt).toLocaleString()}</time>.</p>}
        <Button disabled={!selected || unavailable} onClick={() => {
          setKey(crypto.randomUUID()); setConfirmation(""); setError("");
        }}>Review project recovery</Button>
      </> : <p>No retained deleted projects for this account.</p>}
    <div className="admin-row">
      {cursor && <Button onClick={() => { setCursor(undefined); setSelectedId(""); }}>First deleted projects</Button>}
      {projects.resource?.data.nextCursor && <Button onClick={() => {
        setCursor(projects.resource?.data.nextCursor ?? undefined); setSelectedId("");
      }}>More deleted projects</Button>}
    </div>
    <Modal open={key !== null} title="Recover deleted project" onClose={() => { if (!busy) setKey(null); }}
      footer={<><Button disabled={busy} onClick={() => setKey(null)}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!selected || confirmation !== selected.name || unavailable}
          onClick={() => void restore()}>Restore project</Button></>}>
      <p>Recover {selected?.name} for {user.name}?</p>
      <Field label="Project name confirmation" value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)}
        hint="Enter the exact project name to confirm." autoComplete="off" />
      {error && <p role="alert">{error}</p>}
    </Modal>
  </section>;
}
