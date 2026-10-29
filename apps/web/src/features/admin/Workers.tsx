import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ResponseOf, Worker } from "@quire/contracts";
import { Button, EmptyState, Field, Modal, Spinner, StatusBadge } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

type Policy = ResponseOf<typeof endpoints.workerPolicyGet>;
export function Workers({ client }: { readonly client: AdminClient }) {
  const workers = useAdminResource(client, endpoints.workersList, { params: {}, query: { limit: 200 }, body: undefined });
  const policy = useAdminResource(client, endpoints.workerPolicyGet, { params: {}, query: {}, body: undefined });
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<{ readonly worker: Worker; readonly action: "drain" | "remove" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function confirmAction() {
    const version = workers.resource?.version;
    if (!selected || version === undefined || version === null) return;
    setBusy(true); setMessage("");
    try {
      if (selected.action === "drain") {
        const result = await client.call(endpoints.workerDrain, {
          params: { id: selected.worker.id }, query: {}, body: { expectedVersion: version },
          headers: { "idempotency-key": crypto.randomUUID() },
        });
        if ("error" in result) { setMessage(result.error.message); return; }
        setMessage(`Drain request: ${result.data.status}.`);
      } else {
        const result = await client.call(endpoints.workerDelete, {
          params: { id: selected.worker.id }, query: {}, body: { expectedVersion: version },
        });
        if ("error" in result) { setMessage(result.error.message); return; }
        setMessage("Worker removed.");
      }
      setSelected(null); workers.refresh();
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  const pools = policy.resource?.data.pools ?? [];
  return <section aria-labelledby="admin-workers-title">
    <div className="admin-row admin-page-heading"><h1 id="admin-workers-title">Compile workers</h1>
      <Button onClick={workers.refresh}>Refresh</Button>
      <Button variant="primary" disabled={!pools.length} onClick={() => setAdding(true)}>Add worker</Button></div>
    <p className="admin-muted">Manage the workers that build project PDFs. Draining finishes the current job before accepting no further work.</p>
    {message && <p role="status" className="admin-message">{message}</p>}
    {workers.error ? <p role="alert">{workers.error}</p> : workers.loading ? <Spinner label="Loading workers" />
      : workers.resource?.data.items.length ? <div className="admin-user-table"><table className="admin-table">
        <thead><tr><th>Worker</th><th>Pool</th><th>Status</th><th>Builds today</th><th>Last heartbeat</th><th>Actions</th></tr></thead>
        <tbody>{workers.resource.data.items.map(worker => <tr key={worker.id}>
          <td data-label="Worker"><code title={worker.id}>{worker.id.slice(0, 8)}</code></td>
          <td data-label="Pool">{pools.find(pool => pool.id === worker.poolId)?.name ?? "Unknown pool"}</td>
          <td data-label="Status"><StatusBadge state={worker.state} /></td><td data-label="Builds today">{worker.buildsToday}</td>
          <td data-label="Last heartbeat"><time dateTime={worker.lastHeartbeat}>{new Date(worker.lastHeartbeat).toLocaleTimeString()}</time></td>
          <td data-label="Actions"><div className="admin-row">
            <Button size="small" disabled={worker.state === "offline" || worker.state === "draining" || workers.resource?.version === null}
              onClick={() => setSelected({ worker, action: "drain" })}>Drain</Button>
            <Button size="small" variant="danger" disabled={worker.state === "busy" || workers.resource?.version === null}
              onClick={() => setSelected({ worker, action: "remove" })}>Remove</Button></div></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState icon="cpu" title="No compile workers" description="Add a worker to an available pool to run isolated document builds." />}
    {workers.resource?.version === null && <p role="alert">The server did not return worker concurrency metadata. Refresh before changing workers.</p>}
    {policy.error ? <p role="alert">{policy.error}</p> : policy.resource
      ? <WorkerPolicy key={policy.resource.data.version} policy={policy.resource.data} client={client} onSaved={policy.refresh} />
      : <Spinner label="Loading worker policy" />}
    {adding && policy.resource && <AddWorkers pools={pools} client={client} onClose={() => setAdding(false)}
      onComplete={notice => { setMessage(notice); setAdding(false); workers.refresh(); }} />}
    <Modal open={selected !== null} title={selected?.action === "remove" ? "Remove worker" : "Drain worker"}
      onClose={() => { if (!busy) setSelected(null); }}
      footer={<><Button disabled={busy} onClick={() => setSelected(null)}>Cancel</Button>
        <Button variant={selected?.action === "remove" ? "danger" : "primary"} busy={busy} onClick={() => void confirmAction()}>Confirm</Button></>}>
      <p>{selected?.action === "remove" ? "Remove this worker from the pool?" : "Finish the current job and stop assigning new builds to this worker?"}</p>
      {selected && <p><code>{selected.worker.id}</code></p>}
      {message && <p role="alert">{message}</p>}
    </Modal>
  </section>;
}

function WorkerPolicy({ policy, client, onSaved }: { readonly policy: Policy; readonly client: AdminClient; readonly onSaved: () => void }) {
  const [min, setMin] = useState(policy.min);
  const [max, setMax] = useState(policy.max);
  const [timeout, setTimeout] = useState(policy.timeoutSeconds);
  const [sandbox, setSandbox] = useState(policy.sandbox);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const result = await client.call(endpoints.workerPolicy, {
        params: {}, query: {}, body: { min, max, timeoutSeconds: timeout, sandbox, expectedVersion: policy.version },
      });
      if ("error" in result) setMessage(result.error.message);
      else { setMessage("Worker policy saved."); onSaved(); }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="admin-policy"><h2>Worker policy</h2>
    <form className="admin-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="admin-settings-grid">
        <Field label="Minimum workers" type="number" min={0} max={max} required value={min} onChange={event => setMin(event.currentTarget.valueAsNumber)} />
        <Field label="Maximum workers" type="number" min={min} required value={max} onChange={event => setMax(event.currentTarget.valueAsNumber)} />
        <Field label="Compile timeout (seconds)" type="number" min={1} max={600} required value={timeout} onChange={event => setTimeout(event.currentTarget.valueAsNumber)} />
        <label className="admin-label">Sandbox<select value={sandbox} onChange={event => setSandbox(event.currentTarget.value === "docker" ? "docker" : "bwrap")}>
          <option value="bwrap">Linux namespace isolation</option><option value="docker">Isolated container</option>
        </select></label>
      </div>
      <Button type="submit" busy={busy}>Save policy</Button>
      {message && <p role="status">{message}</p>}
    </form>
  </section>;
}

function AddWorkers({ pools, client, onClose, onComplete }: {
  readonly pools: Policy["pools"]; readonly client: AdminClient;
  readonly onClose: () => void; readonly onComplete: (message: string) => void;
}) {
  const [poolId, setPoolId] = useState(pools[0]?.id ?? "");
  const [count, setCount] = useState(1);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function add() {
    const pool = pools.find(item => item.id === poolId);
    if (!pool) return;
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.workersCreate, {
        params: {}, query: {}, body: { poolId: pool.id, count }, headers: { "idempotency-key": key },
      });
      if ("error" in result) setError(result.error.message);
      else onComplete(`Worker request: ${result.data.status}.`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <Modal open title="Add worker" onClose={() => { if (!busy) onClose(); }}
    footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" form="add-workers" variant="primary" busy={busy}>Add workers</Button></>}>
    <form id="add-workers" className="admin-form" onSubmit={event => { event.preventDefault(); void add(); }}>
      <label className="admin-label">Worker pool<select value={poolId} onChange={event => { setPoolId(event.currentTarget.value); setKey(crypto.randomUUID()); }}>
        {pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}
      </select></label>
      <Field label="Number of workers" type="number" min={1} required value={count} onChange={event => { setCount(event.currentTarget.valueAsNumber); setKey(crypto.randomUUID()); }} />
      {error && <p role="alert">{error}</p>}
    </form>
  </Modal>;
}
