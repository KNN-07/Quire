import { useState } from "react";
import { endpoints } from "@quire/contracts";
import { Button, Modal } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";

export function ScimToken({ client }: { readonly client: AdminClient }) {
  const [key, setKey] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function regenerate() {
    if (!key) return;
    setBusy(true); setMessage("");
    try {
      const response = await client.call(endpoints.scimToken, { params: {}, query: {}, body: {},
        headers: { "idempotency-key": key } });
      if ("error" in response) setMessage(response.error.message);
      else { setToken(response.data.secretOnce); setKey(null); }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="admin-policy"><h2>SCIM provisioning</h2>
    <p>Configure your identity provider with <code>/scim/v2/Users</code> and <code>/scim/v2/Groups</code> and a separate bearer token.</p>
    <Button onClick={() => { setKey(crypto.randomUUID()); setMessage(""); }}>Regenerate SCIM token</Button>
    {token && <div className="admin-message"><p>Save this token securely. It is shown only for this response.</p>
      <code>{token}</code><div><Button onClick={() => setToken(null)}>Hide token</Button></div></div>}
    <Modal open={key !== null} title="Regenerate SCIM token" onClose={() => { if (!busy) setKey(null); }}
      footer={<><Button disabled={busy} onClick={() => setKey(null)}>Cancel</Button>
        <Button busy={busy} variant="danger" onClick={() => void regenerate()}>Replace token</Button></>}>
      <p>The existing provisioning token will stop working. Update your identity provider with the new token.</p>
      {message && <p role="alert">{message}</p>}
    </Modal>
  </section>;
}
