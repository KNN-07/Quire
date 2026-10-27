import { useState } from "react";
import { endpoints, InstantSchema } from "@quire/contracts";
import type { Operation, Release } from "@quire/contracts";
import { Button, EmptyState, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function Updates({ client, navigate }: { readonly client: AdminClient; readonly navigate: (path: string) => void }) {
  const [cursor, setCursor] = useState<string | undefined>();
  const releases = useAdminResource(client, endpoints.releasesList, { params: {}, query: { cursor, limit: 50 }, body: undefined });
  const [selected, setSelected] = useState<Release | null>(null);
  const [schedule, setSchedule] = useState("");
  const [automatic, setAutomatic] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function queueUpdate() {
    if (!selected?.signatureVerified) return;
    setBusy(true); setError("");
    try {
      const at = InstantSchema.parse(requestedAt ?? (schedule ? new Date(schedule).toISOString() : new Date().toISOString()));
      setRequestedAt(at);
      const result = await client.call(endpoints.updateCreate, {
        params: {}, query: {}, body: { releaseId: selected.id, at, autoSecurity: automatic },
        headers: { "idempotency-key": requestKey },
      });
      if ("error" in result) setError(result.error.message);
      else { setOperation(result.data); setSelected(null); releases.refresh(); }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="admin-updates-title">
    <div className="admin-row admin-page-heading"><h1 id="admin-updates-title">Updates</h1><Button onClick={releases.refresh}>Check releases</Button></div>
    <p className="admin-muted">Review signed releases and schedule installation. The server checks compatibility before admitting an update.</p>
    {operation && <div className="admin-message"><p role="status">Update request: {operation.status}.</p>
      <Button onClick={() => navigate(`/admin/support?operation=${operation.id}`)}>View progress</Button></div>}
    {error && <p role="alert">{error}</p>}
    {releases.error ? <p role="alert">{releases.error}</p> : releases.loading ? <Spinner label="Loading releases" />
      : releases.resource?.data.items.length ? <div className="admin-user-table"><table className="admin-table">
        <thead><tr><th>Release</th><th>Signature</th><th>Compatible schemas</th><th>Scheduled</th><th>Actions</th></tr></thead>
        <tbody>{releases.resource.data.items.map(release => <tr key={release.id}>
          <td data-label="Release"><strong>{release.version}</strong><p>{release.notes}</p></td>
          <td data-label="Signature">{release.signatureVerified ? "Verified" : "Not verified"}</td>
          <td data-label="Compatible schemas">{release.compatibleSchema.join(", ")}</td>
          <td data-label="Scheduled">{release.scheduledAt ? <time dateTime={release.scheduledAt}>{new Date(release.scheduledAt).toLocaleString()}</time> : "Not scheduled"}</td>
          <td data-label="Actions"><Button size="small" disabled={!release.signatureVerified || Boolean(release.scheduledAt)}
            onClick={() => { setSelected(release); setSchedule(""); setRequestedAt(null); setAutomatic(false); setRequestKey(crypto.randomUUID()); setError(""); }}>
            Schedule update</Button></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="No releases available" description="No releases have been returned by the configured release source." />}
    <div className="admin-row">{cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
      {releases.resource?.data.nextCursor && <Button onClick={() => setCursor(releases.resource?.data.nextCursor ?? undefined)}>Next page</Button>}</div>
    <Modal open={selected !== null} title={selected ? `Install ${selected.version}` : "Schedule update"} onClose={() => { if (!busy) setSelected(null); }}
      footer={<><Button disabled={busy} onClick={() => setSelected(null)}>Cancel</Button>
        <Button variant="primary" type="submit" form="schedule-update" busy={busy}>Schedule installation</Button></>}>
      <p>{selected?.notes}</p>
      <form id="schedule-update" className="admin-form" onSubmit={event => { event.preventDefault(); void queueUpdate(); }}>
        <Field label="Install at" type="datetime-local" value={schedule} hint="Leave empty to request installation now."
          onChange={event => { setSchedule(event.currentTarget.value); setRequestedAt(null); setRequestKey(crypto.randomUUID()); }} />
        <label className="admin-check"><input type="checkbox" checked={automatic}
          onChange={event => { setAutomatic(event.currentTarget.checked); setRequestedAt(null); setRequestKey(crypto.randomUUID()); }} />
          Enable automatic security updates</label>
        {error && <p role="alert">{error}</p>}
      </form>
    </Modal>
  </section>;
}
