import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { Button, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function EditorMaintenance({ client }: { readonly client: AdminClient }) {
  const policy = useAdminResource(client, endpoints.adminEditorStateGet, { params: {}, query: {}, body: undefined });
  return policy.error ? <p role="alert">{policy.error}</p> : policy.resource
    ? <MaintenanceForm key={policy.resource.data.version} client={client} policy={policy.resource.data} refresh={policy.refresh} />
    : <Spinner label="Loading editor maintenance policy" />;
}
function MaintenanceForm({ client, policy, refresh }: {
  readonly client: AdminClient; readonly policy: ResponseOf<typeof endpoints.adminEditorStateGet>; readonly refresh: () => void;
}) {
  const [closed, setClosed] = useState(policy.closed);
  const [message, setMessage] = useState(policy.message);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await client.call(endpoints.adminEditorState, { params: {}, query: {},
        body: { closed, message, expectedVersion: policy.version } });
      if ("error" in response) setError(response.error.message);
      else { setConfirm(false); refresh(); }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="admin-policy"><h2>Editor maintenance</h2>
    <p>Editing is currently {policy.closed ? "closed" : "open"}. Source reads and downloads remain available during maintenance.</p>
    <form className="admin-form" onSubmit={event => { event.preventDefault(); setConfirm(true); }}>
      <label className="admin-check"><input type="checkbox" checked={closed} onChange={event => setClosed(event.currentTarget.checked)} />Close editing temporarily</label>
      <Field label="Message for collaborators" value={message} onChange={event => setMessage(event.currentTarget.value)} />
      <Button type="submit">Review maintenance change</Button>
    </form>
    <Modal open={confirm} title={closed ? "Close editing" : "Reopen editing"} onClose={() => { if (!busy) setConfirm(false); }}
      footer={<><Button disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button>
        <Button busy={busy} variant={closed ? "danger" : "primary"} onClick={() => void save()}>Confirm change</Button></>}>
      <p>{closed ? "Stop source changes and new compilation requests across this instance." : "Allow authorized collaborators to edit and compile again."}</p>
      <p>{message}</p>{error && <p role="alert">{error}</p>}
    </Modal>
  </section>;
}
