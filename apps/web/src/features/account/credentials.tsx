import { useEffect, useState } from "react";
import { endpoints, InstantSchema } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { Button, Field } from "../../ui";
import { listInput, mutationHeaders, Notice, Panel, unwrap, useAction, value } from "./shared";
import type { SettingsProps } from "./settings";

export function Credentials(props: SettingsProps) {
  const [tokens, setTokens] = useState<ResponseOf<typeof endpoints.gitTokensList> | null>(null);
  const [keys, setKeys] = useState<ResponseOf<typeof endpoints.sshKeysList> | null>(null);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const action = useAction();
  async function load(signal?: AbortSignal) {
    const responses = await Promise.all([props.client.call(endpoints.gitTokensList, listInput, signal), props.client.call(endpoints.sshKeysList, listInput, signal)]);
    setTokens(unwrap(responses[0])); setKeys(unwrap(responses[1]));
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => { if (controller.signal.aborted) return; if (cause instanceof Error) setError(cause.message); else throw cause; });
    return () => controller.abort();
  }, [props.client]);
  return <Panel title="Git credentials">
    {error && <><Notice error={error} message="" /><Button onClick={() => { void action.run(async () => { await load(); setError(""); }); }}>Reload credentials</Button></>}
    <h3>Git access tokens</h3>
    {!tokens && !error ? <p role="status">Loading tokens…</p> : tokens?.items.length === 0 ? <p>No Git access tokens. Generate one for your Git CLI.</p> : <ul className="account-list">{tokens?.items.map(token => <li key={token.id}><div className="account-row"><span>{token.name}<small>Expires {new Date(token.expiresAt).toLocaleString()}</small></span><Button variant="danger" busy={action.busy} onClick={() => { void action.run(async () => {
      unwrap(await props.client.call(endpoints.gitTokenDelete, { params: { id: token.id }, query: {}, body: { expectedVersion: token.version } })); await load();
    }); }}>Revoke {token.name}</Button></div></li>)}</ul>}
    <form className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        const expiresAt = InstantSchema.parse(new Date(value(form, "expiry")).toISOString());
        const result = unwrap(await props.client.call(endpoints.gitTokenCreate, { params: {}, query: {}, body: { name: value(form, "name"), expiresAt }, headers: mutationHeaders() }));
        setSecret(result.secretOnce); await load();
      });
    }}>
      <Field label="Token name" name="name" required /><Field label="Expires at" name="expiry" type="datetime-local" required />
      <Button type="submit" busy={action.busy}>Generate token</Button>
    </form>
    {secret && <div className="account-stack"><p>Copy this token now. It is only returned once.</p><output className="account-code" aria-label="New Git token">{secret}</output><div className="account-row"><Button onClick={() => { void action.run(async () => { await navigator.clipboard.writeText(secret); action.setMessage("Token copied."); }); }}>Copy token</Button><Button onClick={() => setSecret("")}>Hide token</Button></div></div>}
    <h3>SSH keys</h3>
    {!keys && !error ? <p role="status">Loading SSH keys…</p> : keys?.items.length === 0 ? <p>No SSH keys. Add a public key; never upload a private key.</p> : <ul className="account-list">{keys?.items.map(key => <li key={key.id}><div className="account-row"><span>{key.name}<small className="account-code">{key.publicKey}</small></span>
      <Button variant="danger" busy={action.busy} onClick={() => { void action.run(async () => {
        const current = unwrap(await props.client.call(endpoints.sshKeyGet, { params: { id: key.id }, query: {}, body: undefined }));
        unwrap(await props.client.call(endpoints.sshKeyDelete, { params: { id: current.id }, query: {}, body: { expectedVersion: current.version } })); await load();
      }); }}>Remove {key.name}</Button></div></li>)}</ul>}
    <form className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        unwrap(await props.client.call(endpoints.sshKeyCreate, { params: {}, query: {}, body: { name: value(form, "name"), publicKey: value(form, "publicKey") }, headers: mutationHeaders() }));
        await load(); action.setMessage("SSH key added.");
      });
    }}>
      <Field label="SSH key name" name="name" required />
      <label className="q-field"><span className="q-field__label">Public key</span><textarea className="q-input" name="publicKey" required placeholder="ssh-ed25519 …" /></label>
      <Button type="submit" busy={action.busy}>Add SSH key</Button>
    </form><Notice {...action} />
  </Panel>;
}
