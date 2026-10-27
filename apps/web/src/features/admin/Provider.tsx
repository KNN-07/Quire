import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Policy, ProviderConfig } from "@quire/contracts";
import { Button, Field, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function Provider({ client }: { readonly client: AdminClient }) {
  const settings = useAdminResource(client, endpoints.providerGet, { params: { kind: "ai" }, query: {}, body: undefined });
  const [message, setMessage] = useState("");
  return <section aria-labelledby="admin-provider-title">
    <div className="admin-row admin-page-heading"><h1 id="admin-provider-title">AI provider</h1>
      <Button onClick={settings.refresh}>Refresh</Button></div>
    <p className="admin-muted">Connect an operator-managed endpoint. Project content is sent only when an authorized user invokes an allowed AI tool.</p>
    {message && <p role="status" className="admin-message">{message}</p>}
    {settings.error ? <p role="alert">{settings.error}</p> : settings.loading ? <Spinner label="Loading provider configuration" />
      : settings.resource && <ProviderForm key={settings.resource.data.version} client={client}
        configuration={settings.resource.data} etag={settings.resource.etag}
        onSaved={() => { setMessage("Provider configuration saved."); settings.refresh(); }} />}
  </section>;
}

function ProviderForm({ client, configuration, etag, onSaved }: {
  readonly client: AdminClient; readonly configuration: ProviderConfig;
  readonly etag: string | null; readonly onSaved: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(configuration.baseUrl);
  const [model, setModel] = useState(configuration.model ?? "");
  const [secret, setSecret] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [mode, setMode] = useState<Policy["ai"]>(configuration.policy.ai);
  const [unlimited, setUnlimited] = useState(configuration.policy.aiDailyUses === null);
  const [dailyUses, setDailyUses] = useState(String(configuration.policy.aiDailyUses ?? 50));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    if (!etag) { setMessage("Refresh the configuration before saving."); return; }
    setBusy(true); setMessage("");
    try {
      const result = await client.call(endpoints.providerPut, {
        params: { kind: configuration.kind }, query: {},
        body: { baseUrl, ...(model ? { model } : {}),
          ...(removeSecret ? { secret: "" } : secret ? { secret } : {}),
          policy: { ...configuration.policy, ai: mode, aiDailyUses: unlimited ? null : Number(dailyUses) },
          expectedVersion: configuration.version },
        headers: { "if-match": etag },
      });
      if ("error" in result) setMessage(result.error.message);
      else { setSecret(""); onSaved(); }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function testConnection() {
    setBusy(true); setMessage("");
    try {
      const result = await client.call(endpoints.providerTest, {
        params: { kind: configuration.kind }, query: {}, body: { expectedVersion: configuration.version },
      });
      if ("error" in result) setMessage(result.error.message);
      else setMessage(result.data.ok ? "Connection verified." : result.data.reason ?? "The provider connection could not be verified.");
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <>
    <form className="admin-form admin-policy" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2>Connection</h2>
      <Field label="API endpoint" type="url" required value={baseUrl} placeholder="https://your-provider.example/v1"
        onChange={event => setBaseUrl(event.currentTarget.value)} />
      <Field label="Model" value={model} onChange={event => setModel(event.currentTarget.value)} />
      <Field label={configuration.secretPresent ? "Replace API credential" : "API credential"} type="password"
        autoComplete="new-password" disabled={removeSecret} value={secret}
        hint={configuration.secretPresent ? "Leave blank to retain the saved credential." : "Stored encrypted on the server; never returned to the browser."}
        onChange={event => setSecret(event.currentTarget.value)} />
      {configuration.secretPresent && <label className="admin-check"><input type="checkbox" checked={removeSecret}
        onChange={event => setRemoveSecret(event.currentTarget.checked)} />Remove the saved credential</label>}
      <h2>Usage policy</h2>
      <label className="admin-label">Allowed assistance<select value={mode}
        onChange={event => setMode(event.currentTarget.value === "agent" ? "agent" : event.currentTarget.value === "ask" ? "ask" : "off")}>
        <option value="off">Disabled</option><option value="ask">Read-only assistance</option>
        <option value="agent">Assistance with reviewed edits</option>
      </select></label>
      <label className="admin-check"><input type="checkbox" checked={unlimited}
        onChange={event => setUnlimited(event.currentTarget.checked)} />No daily application allowance limit</label>
      {!unlimited && <Field label="Daily uses per user" type="number" min={0} required value={dailyUses}
        onChange={event => setDailyUses(event.currentTarget.value)} />}
      <p className="admin-muted">Organization, project and user restrictions still apply. Generated edits require review before they change a document.</p>
      <div className="admin-row"><Button variant="primary" type="submit" busy={busy} disabled={!etag}>Save configuration</Button>
        <Button busy={busy} onClick={() => void testConnection()}>Test saved connection</Button></div>
      {message && <p role="status">{message}</p>}
    </form>
    <section className="admin-policy"><h2>Available capabilities</h2>
      {Object.keys(configuration.capabilities).length
        ? <dl className="admin-values">{Object.entries(configuration.capabilities).map(([name, capability]) => <div key={name}>
          <dt>{name}</dt><dd>{capability.state}{capability.reason ? `: ${capability.reason}` : ""}</dd>
        </div>)}</dl> : <p className="admin-muted">No provider capabilities are configured.</p>}
    </section>
  </>;
}
