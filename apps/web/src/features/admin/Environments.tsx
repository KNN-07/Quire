import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Environment, Id } from "@quire/contracts";
import { Button, EmptyState, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage, parseJson } from "./api";
import { useAdminResource } from "./useAdminResource";
import { EnvironmentFonts } from "./EnvironmentFonts";

export function Environments({ client, navigate }: {
  readonly client: AdminClient; readonly navigate: (path: string) => void;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const environments = useAdminResource(client, endpoints.adminEnvironments, {
    params: {}, query: { limit: 50, cursor }, body: undefined,
  });
  const admissions = useAdminResource(client, endpoints.environmentsAdmission, {
    params: {}, query: {}, body: undefined,
  });
  const refresh = () => { environments.refresh(); admissions.refresh(); };
  const [selected, setSelected] = useState<{ readonly environment: Environment; readonly retire: boolean } | null>(null);
  const [manifest, setManifest] = useState<File | null>(null);
  const [base, setBase] = useState("");
  const [packages, setPackages] = useState("");
  const [mirror, setMirror] = useState("");
  const [fonts, setFonts] = useState<readonly Id[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [operation, setOperation] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  async function register() {
    if (!manifest) return;
    setBusy(true); setMessage("");
    try {
      const input = endpoints.environmentCreate.input.parse({
        params: {}, query: {}, body: { manifest: parseJson(await manifest.text()) },
        headers: { "idempotency-key": requestKey },
      });
      const result = await client.call(endpoints.environmentCreate, input);
      if ("error" in result) setMessage(result.error.message);
      else {
        setMessage(`${result.data.label} registered; toolchain ${result.data.available ? "probes passed" : "unavailable"}. Review execution admission separately.`);
        setRequestKey(crypto.randomUUID()); refresh();
      }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function build() {
    const environment = environments.resource?.data.items.find(item => item.id === base);
    if (!environment) return;
    setBusy(true); setMessage(""); setOperation(null);
    try {
      const result = await client.call(endpoints.environmentBuild, { params: {}, query: {},
        body: { baseId: environment.id, packageList: packages.split(/\s+/).filter(Boolean), fontUploads: [...fonts], mirror },
        headers: { "idempotency-key": requestKey },
      });
      if ("error" in result) setMessage(result.error.message);
      else {
        setMessage(`Environment build: ${result.data.status}.`); setOperation(result.data.id);
        setRequestKey(crypto.randomUUID());
      }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function update() {
    const status = admissions.resource?.data.find(item => item.environment.id === selected?.environment.id);
    const version = status?.version;
    if (!selected || version === null || version === undefined) return;
    setBusy(true); setMessage("");
    try {
      const endpoint = selected.retire ? endpoints.environmentRetire : endpoints.environmentDefault;
      const result = await client.call(endpoint, {
        params: { id: selected.environment.id }, query: {}, body: { expectedVersion: version },
      });
      if ("error" in result) setMessage(result.error.message);
      else { setMessage(selected.retire ? "Environment retired." : "Default environment saved."); setSelected(null); refresh(); }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="admin-environments-title">
    <div className="admin-row admin-page-heading"><h1 id="admin-environments-title">TeX Live images</h1>
      <Button onClick={refresh}>Refresh</Button></div>
    <p className="admin-muted">Manage pinned compiler environments. Existing projects keep their selected environment.</p>
    <p>Toolchain probes and signed execution admission are separate. Building an image does not authorize managed workers.
      An operator must review an admission proposal and deploy its exact environment ID and image profile in the next signed release.</p>
    {admissions.error && <p role="alert">Execution admission could not be read: {admissions.error}</p>}
    {message && <p role="status" className="admin-message">{message}</p>}
    {operation && <Button onClick={() => navigate(`/admin/support?operation=${operation}`)}>View build operation</Button>}
    {environments.error ? <p role="alert">{environments.error}</p> : environments.loading ? <Spinner label="Loading environments" />
      : environments.resource?.data.items.length ? <div className="admin-user-table"><table className="admin-table">
        <thead><tr><th>Environment</th><th>Runtime</th><th>Engines</th><th>Toolchain / execution</th><th>Actions</th></tr></thead>
        <tbody>{environments.resource.data.items.map(environment => {
          const admission = admissions.resource?.data.find(item => item.environment.id === environment.id);
          return <tr key={environment.id}>
          <td data-label="Environment"><strong>{environment.label}</strong><small>{environment.release}</small></td>
          <td data-label="Runtime">{environment.backend}<small>{environment.experimental ? "Experimental" : "Stable"}</small></td>
          <td data-label="Engines">{environment.engines.join(", ")}<small>{environment.helpers.join(", ")}</small></td>
          <td data-label="Toolchain / execution">Toolchain: {admission?.probe ?? "unknown"}<small>{environment.probeAt
            ? `Checked ${new Date(environment.probeAt).toLocaleString()}` : "Not probed"}</small>
            <small>{admission?.execution.state === "admitted" ? "Signed execution admitted"
              : admission?.execution.state === "not-admitted" ? "Signed admission required"
                : admission?.execution.state === "unmanaged" ? "Unmanaged deployment" : "Execution admission unknown"}</small>
            {admission?.execution.route && <small>{admission.execution.route.workerRole}: {admission.execution.route.profileIds.join(", ")}</small>}
          </td>
          <td data-label="Actions"><div className="admin-row">
            <Button size="small" disabled={!admission?.selectable}
              onClick={() => setSelected({ environment, retire: false })}>Set default</Button>
            <Button size="small" disabled={!admission}
              onClick={() => setSelected({ environment, retire: true })}>Retire</Button>
          </div></td>
        </tr>; })}</tbody>
      </table></div> : <EmptyState title="No environments registered" description="Import a compiler manifest or build a verified environment." />}
    <div className="admin-row">{cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
      {environments.resource?.data.nextCursor && <Button onClick={() => setCursor(environments.resource?.data.nextCursor ?? undefined)}>Next page</Button>}</div>
    <section className="admin-policy"><h2>Register an environment</h2>
      <p>Import the deployment-generated JSON manifest containing its pinned runtime and package digests.</p>
      <form className="admin-form" onSubmit={event => { event.preventDefault(); void register(); }}>
        <Field label="Environment manifest" type="file" accept=".json,application/json" required
          onChange={event => { setManifest(event.currentTarget.files?.[0] ?? null); setRequestKey(crypto.randomUUID()); }} />
        <Button type="submit" busy={busy} disabled={!manifest}>Register manifest</Button>
      </form>
    </section>
    <section className="admin-policy"><h2>Build an environment</h2>
      <form className="admin-form" onSubmit={event => { event.preventDefault(); void build(); }}>
        <label className="admin-label">Base environment<select required value={base} onChange={event => { setBase(event.currentTarget.value); setRequestKey(crypto.randomUUID()); }}>
          <option value="">Choose an environment</option>
          {environments.resource?.data.items.map(environment => <option key={environment.id} value={environment.id}>{environment.label}</option>)}
        </select></label>
        <Field label="Package mirror URL" type="url" required value={mirror}
          onChange={event => { setMirror(event.currentTarget.value); setRequestKey(crypto.randomUUID()); }} />
        <label className="admin-label">Additional packages<textarea value={packages} placeholder="One package name per line"
          onChange={event => { setPackages(event.currentTarget.value); setRequestKey(crypto.randomUUID()); }} /></label>
        <EnvironmentFonts client={client} value={fonts} onChange={ids => { setFonts(ids); setRequestKey(crypto.randomUUID()); }} />
        <Button type="submit" busy={busy} disabled={!base}>Build environment</Button>
      </form>
    </section>
    <Modal open={selected !== null} title={selected?.retire ? "Retire environment" : "Set default environment"}
      onClose={() => { if (!busy) setSelected(null); }}
      footer={<><Button disabled={busy} onClick={() => setSelected(null)}>Cancel</Button>
        <Button busy={busy} variant={selected?.retire ? "danger" : "primary"} onClick={() => void update()}>
          {selected?.retire ? "Retire" : "Set default"}</Button></>}>
      <p>{selected?.environment.label}</p>
      <p>{selected?.retire ? "Retire this environment from new selections. The server checks existing project references before changing availability."
        : "Use this environment for newly created projects."}</p>
      {message && <p role="alert">{message}</p>}
    </Modal>
  </section>;
}
