import { useState } from "react";
import { endpoints, InstantSchema } from "@quire/contracts";
import type { AuditEntry, RequestOf, ResponseOf } from "@quire/contracts";
import { Button, EmptyState, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { downloadBytes, errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function Audit({ client, navigate }: { readonly client: AdminClient; readonly navigate: (path: string) => void }) {
  const [event, setEvent] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filter, setFilter] = useState<RequestOf<typeof endpoints.auditExport>["body"]>({});
  const [cursor, setCursor] = useState<string | undefined>();
  const rows = useAdminResource(client, endpoints.auditList, { params: {}, query: { ...filter, cursor, limit: 50 }, body: undefined });
  const siem = useAdminResource(client, endpoints.auditSiemGet, { params: {}, query: {}, body: undefined });
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function apply() {
    try {
      const next = { ...(event.trim() ? { event: event.trim() } : {}),
        ...(from ? { from: InstantSchema.parse(new Date(from).toISOString()) } : {}),
        ...(to ? { to: InstantSchema.parse(new Date(to).toISOString()) } : {}) };
      if (next.from && next.to && next.from > next.to) { setMessage("Start must precede end."); return; }
      setMessage(""); setFilter(next); setCursor(undefined);
    } catch (failure) { setMessage(errorMessage(failure)); }
  }
  async function exportRows() {
    setBusy(true); setMessage("");
    try {
      const response = await client.call(endpoints.auditExport, { params: {}, query: {}, body: filter,
        headers: { "idempotency-key": crypto.randomUUID() } });
      if ("error" in response) { setMessage(response.error.message); return; }
      const operation = response.data;
      if (operation.status === "succeeded" && operation.result?.["format"] === "zip") {
        const download = await client.call(endpoints.operationDownload, { params: { id: operation.id }, query: {}, body: undefined });
        if ("error" in download) { setMessage(download.error.message); return; }
        downloadBytes(download.data, "audit.zip"); setMessage("Audit export downloaded.");
      } else navigate(`/admin/support?operation=${operation.id}`);
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="admin-audit-title">
    <div className="admin-row admin-page-heading"><h1 id="admin-audit-title">Audit log</h1>
      <Button onClick={rows.refresh}>Refresh</Button><Button busy={busy} onClick={() => void exportRows()}>Export ZIP</Button></div>
    <form className="admin-form" onSubmit={e => { e.preventDefault(); apply(); }}>
      <div className="admin-settings-grid">
        <Field label="Event" value={event} placeholder="All events" onChange={e => setEvent(e.currentTarget.value)} />
        <Field label="From (local time)" type="datetime-local" value={from} onChange={e => setFrom(e.currentTarget.value)} />
        <Field label="To (local time)" type="datetime-local" value={to} onChange={e => setTo(e.currentTarget.value)} />
      </div><Button type="submit">Apply filters</Button>
    </form>
    {message && <p role="status" className="admin-message">{message}</p>}
    {rows.error ? <p role="alert">{rows.error}</p> : rows.loading ? <Spinner label="Loading audit events" />
      : rows.resource?.data.items.length ? <div className="admin-resource">
        <table className="admin-table"><thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Details</th></tr></thead>
          <tbody>{rows.resource.data.items.map(row => <tr key={row.id}>
            <td data-label="Time"><time dateTime={row.at}>{new Date(row.at).toLocaleString()}</time></td>
            <td data-label="Event">{row.event}</td><td data-label="Actor"><code>{row.actorId ?? "System"}</code></td>
            <td data-label="Details"><Button size="small" onClick={() => setSelected(row)}>Inspect</Button></td>
          </tr>)}</tbody></table>
      </div> : <EmptyState title="No matching events" description="Change the event or time filters to inspect other activity." />}
    <div className="admin-row">{cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
      {rows.resource?.data.nextCursor && <Button onClick={() => setCursor(rows.resource?.data.nextCursor ?? undefined)}>Next page</Button>}</div>
    {siem.error ? <p role="alert">SIEM configuration: {siem.error}</p> : siem.resource
      ? <Siem key={siem.resource.data.version} client={client} config={siem.resource.data} etag={siem.resource.etag}
        onSaved={() => { setMessage("SIEM configuration saved."); siem.refresh(); }} />
      : <Spinner label="Loading SIEM configuration" />}
    <Modal open={selected !== null} title="Audit event" onClose={() => setSelected(null)}>
      {selected && <dl className="admin-values">
        <div><dt>Event</dt><dd>{selected.event}</dd></div><div><dt>Target</dt><dd><code>{selected.targetId}</code></dd></div>
        <div><dt>IP address</dt><dd>{selected.ip ?? "Not recorded"}</dd></div>
        {Object.entries(selected.details).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{String(value ?? "")}</dd></div>)}
      </dl>}
    </Modal>
  </section>;
}

function Siem({ client, config, etag, onSaved }: {
  readonly client: AdminClient; readonly config: ResponseOf<typeof endpoints.auditSiemGet>;
  readonly etag: string | null; readonly onSaved: () => void;
}) {
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [enabled, setEnabled] = useState(config.enabled);
  const [secret, setSecret] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!etag) return;
    setBusy(true); setError("");
    try {
      const response = await client.call(endpoints.auditSiem, { params: {}, query: {},
        body: { endpoint, enabled, expectedVersion: config.version,
          ...(removeSecret ? { secret: "" } : secret ? { secret } : {}) },
        headers: { "if-match": etag } });
      if ("error" in response) setError(response.error.message);
      else onSaved();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="admin-policy"><h2>SIEM forwarding</h2>
    <form className="admin-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <Field label="Collector URL" type="url" required value={endpoint} onChange={e => setEndpoint(e.currentTarget.value)} />
      <Field label="Collector credential" type="password" value={secret} autoComplete="new-password" disabled={removeSecret}
        hint={config.secretPresent ? "A credential is stored. Leave blank to retain it." : "No credential is stored."}
        onChange={e => setSecret(e.currentTarget.value)} />
      <label className="admin-check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.currentTarget.checked)} />Enable forwarding</label>
      {config.secretPresent && <label className="admin-check"><input type="checkbox" checked={removeSecret}
        onChange={e => setRemoveSecret(e.currentTarget.checked)} />Remove stored credential</label>}
      <Button type="submit" busy={busy} disabled={!etag}>Save forwarding</Button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
