import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Backup, ResponseOf } from "@quire/contracts";
import { Button, EmptyState, Field, Modal, Spinner, StatusBadge } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function Backups({ client, navigate }: { readonly client: AdminClient; readonly navigate: (path: string) => void }) {
  const [cursor, setCursor] = useState<string | undefined>();
  const backups = useAdminResource(client, endpoints.backupsList, { params: {}, query: { cursor, limit: 50 }, body: undefined });
  const policy = useAdminResource(client, endpoints.backupPolicyGet, { params: {}, query: {}, body: undefined });
  const [selected, setSelected] = useState<{ readonly backup: Backup; readonly kind: "verify" | "restore"; readonly key: string } | null>(null);
  const [target, setTarget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function createBackup() {
    setBusy(true); setMessage("");
    try {
      const result = await client.call(endpoints.backupCreate, {
        params: {}, query: {}, body: {}, headers: { "idempotency-key": createKey },
      });
      if ("error" in result) setMessage(result.error.message);
      else { setMessage(`Backup request: ${result.data.status}.`); setCreateKey(crypto.randomUUID()); backups.refresh(); }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function perform() {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      if (selected.kind === "verify") {
        const result = await client.call(endpoints.backupVerify, {
          params: { id: selected.backup.id }, query: {}, body: { expectedVersion: 0 },
          headers: { "idempotency-key": selected.key },
        });
        if ("error" in result) { setMessage(result.error.message); return; }
        setMessage(`Verification request: ${result.data.status}.`);
      } else {
        const result = await client.call(endpoints.backupRestore, {
          params: { id: selected.backup.id }, query: {}, body: {
            target, confirmation: `RESTORE ${selected.backup.id} TO ${target}`, expectedVersion: 0,
          },
          headers: { "idempotency-key": selected.key },
        });
        if ("error" in result) { setMessage(result.error.message); return; }
        setMessage(`Restore request: ${result.data.status}.`);
      }
      setSelected(null); backups.refresh();
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="admin-backups-title">
    <div className="admin-row admin-page-heading"><h1 id="admin-backups-title">Storage &amp; backups</h1>
      <Button onClick={backups.refresh}>Refresh</Button><Button variant="primary" busy={busy} onClick={() => void createBackup()}>Create backup</Button></div>
    <p className="admin-muted">Full backups include the database, source history, review state and stored files. Project ZIP downloads are not full backups.</p>
    {message && <p role="status" className="admin-message">{message}</p>}
    {backups.error ? <p role="alert">{backups.error}</p> : backups.loading ? <Spinner label="Loading backups" />
      : backups.resource?.data.items.length ? <div className="admin-user-table"><table className="admin-table">
        <thead><tr><th>Created</th><th>Destination</th><th>Status</th><th>Verification</th><th>Actions</th></tr></thead>
        <tbody>{backups.resource.data.items.map(backup => <tr key={backup.id}>
          <td data-label="Created"><time dateTime={backup.createdAt}>{new Date(backup.createdAt).toLocaleString()}</time></td>
          <td data-label="Destination"><code>{backup.destination}</code></td><td data-label="Status"><StatusBadge state={backup.status} /></td>
          <td data-label="Verification">{backup.verifiedAt ? <time dateTime={backup.verifiedAt}>{new Date(backup.verifiedAt).toLocaleString()}</time> : "Not verified"}</td>
          <td data-label="Actions"><div className="admin-row">
            <Button size="small" disabled={backup.status !== "succeeded"}
              onClick={() => { setSelected({ backup, kind: "verify", key: crypto.randomUUID() }); setMessage(""); }}>Verify</Button>
            <Button size="small" disabled={!backup.verifiedAt || backup.status !== "succeeded"}
              onClick={() => { setSelected({ backup, kind: "restore", key: crypto.randomUUID() }); setTarget(""); setConfirmed(false); setMessage(""); }}>Restore</Button>
            <Button size="small" onClick={() => navigate(`/admin/support?operation=${backup.operationId}`)}>Details</Button>
          </div></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState icon="database" title="No backups yet" description="Create a complete backup before changing or updating your instance." />}
    <div className="admin-row">{cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
      {backups.resource?.data.nextCursor && <Button onClick={() => setCursor(backups.resource?.data.nextCursor ?? undefined)}>Next page</Button>}</div>
    {policy.error ? <p role="alert">{policy.error}</p> : policy.resource
      ? <BackupPolicy key={policy.resource.data.version} client={client} policy={policy.resource.data} etag={policy.resource.etag}
        onSaved={() => { setMessage("Backup policy saved."); policy.refresh(); }} />
      : <Spinner label="Loading backup policy" />}
    <Modal open={selected !== null} title={selected?.kind === "restore" ? "Restore backup" : "Verify backup"}
      onClose={() => { if (!busy) setSelected(null); }}
      footer={<><Button disabled={busy} onClick={() => setSelected(null)}>Cancel</Button>
        <Button variant={selected?.kind === "restore" ? "danger" : "primary"} busy={busy}
          disabled={selected?.kind === "restore" && (!target.trim() || !confirmed)} onClick={() => void perform()}>
          {selected?.kind === "restore" ? "Restore to target" : "Verify backup"}
        </Button></>}>
      {selected && <p>Backup from {new Date(selected.backup.createdAt).toLocaleString()} at <code>{selected.backup.destination}</code>.</p>}
      {selected?.kind === "restore" ? <div className="admin-form">
        <Field label="Isolated restore directory" value={target} required onChange={event => setTarget(event.currentTarget.value)} />
        <label className="admin-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />
          I confirm restoration into this isolated target.</label>
      </div> : <p>Validate the backup manifest and stored data before attempting a restore.</p>}
      {message && <p role="alert">{message}</p>}
    </Modal>
  </section>;
}

function BackupPolicy({ client, policy, etag, onSaved }: {
  readonly client: AdminClient; readonly policy: ResponseOf<typeof endpoints.backupPolicyGet>;
  readonly etag: string | null; readonly onSaved: () => void;
}) {
  const [schedule, setSchedule] = useState(policy.schedule === "disabled" ? "" : policy.schedule);
  const [retention, setRetention] = useState(String(policy.retentionDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!etag) { setError("Refresh the policy before saving."); return; }
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.backupPolicyPut, {
        params: {}, query: {}, body: { schedule: schedule.trim() || "disabled",
          retentionDays: Number(retention), destination: policy.destination, expectedVersion: policy.version },
        headers: { "if-match": etag },
      });
      if ("error" in result) setError(result.error.message);
      else onSaved();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="admin-policy"><h2>Backup policy</h2>
    <form className="admin-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field label="Destination" readOnly value={policy.destination}
        hint="Fixed private backup root provisioned by the operator. Change deployment configuration to relocate it." />
      <div className="admin-settings-grid">
        <Field label="Schedule (cron)" value={schedule}
          hint="Daily UTC only: minute hour * * * (for example, 0 3 * * *). Leave empty for manual-only."
          onChange={event => setSchedule(event.currentTarget.value)} />
        <Field label="Retention (days)" type="number" min={1} max={36500} step={1} required value={retention} onChange={event => setRetention(event.currentTarget.value)} />
      </div>
      <p className="admin-muted">Saving a schedule does not install or start a timer. The deployment operator must
        configure a private timer to run the scheduled backup command once per minute under an enrolled operator's authority.
        It evaluates UTC and catches up only the latest due daily slot; duplicate invocations are deduplicated.</p>
      <p><code>bun scripts/ops/backup.ts --action scheduled --operator &lt;enrolled-operator-UUID&gt;</code></p>
      <Button type="submit" busy={busy} disabled={!etag}>Save policy</Button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
