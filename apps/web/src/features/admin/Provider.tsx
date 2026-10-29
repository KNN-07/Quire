import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Policy, ProviderConfig } from "@quire/contracts";
import { Button, Field, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function Provider({ client }: { readonly client: AdminClient }) {
  const settings = useAdminResource(client, endpoints.providerGet, { params: { kind: "ai" }, query: {}, body: undefined });
  const policy = useAdminResource(client, endpoints.providerAiPolicyGet, { params: {}, query: {}, body: undefined });
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
    {policy.error ? <p role="alert">{policy.error}</p> : policy.loading ? <Spinner label="Loading AI data policy" />
      : policy.resource && <DataPolicyForm key={policy.resource.data.version} client={client}
        policy={policy.resource.data} etag={policy.resource.etag}
        onRefresh={policy.refresh}
        onSaved={() => { setMessage("AI data policy saved."); policy.refresh(); }} />}
  </section>;
}

function DataPolicyForm({ client, policy, etag, onSaved, onRefresh }: {
  readonly client: AdminClient; readonly policy: NonNullable<ProviderConfig["aiPolicy"]>;
  readonly etag: string | null; readonly onSaved: () => void; readonly onRefresh: () => void;
}) {
  const [requestLogging, setRequestLogging] = useState(policy.requestLogging);
  const [citationWebSearch, setCitationWebSearch] = useState(policy.citationWebSearch);
  const [blockConfidentialTags, setBlockConfidentialTags] = useState(policy.blockConfidentialTags);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    if (!etag) { setMessage("Refresh the AI data policy before saving."); return; }
    setBusy(true); setMessage("");
    try {
      const result = await client.call(endpoints.providerAiPolicyPut, {
        params: {}, query: {}, headers: { "if-match": etag },
        body: { requestLogging, citationWebSearch, blockConfidentialTags, expectedVersion: policy.version },
      });
      if ("error" in result) setMessage(result.error.message);
      else onSaved();
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <form className="admin-form admin-policy" aria-labelledby="ai-data-policy-title"
    onSubmit={event => { event.preventDefault(); void save(); }}>
    <h2 id="ai-data-policy-title">AI data policy</h2>
    <p className="admin-muted">Policy version {policy.version}. Saved separately from the connection. Changes cancel pending AI output.</p>
    <label className="admin-label">Request logging<select value={requestLogging}
      onChange={event => setRequestLogging(event.currentTarget.value === "retained-content" ? "retained-content"
        : event.currentTarget.value === "metadata" ? "metadata" : "off")}>
      <option value="off">Off</option><option value="metadata">Request metadata only</option>
      <option value="retained-content">Retained prompts and responses</option>
    </select></label>
    <p className="admin-muted">Content audit encrypts only prompts and responses already retained in Agent or shared conversations.
      Private Ask stays session-local. File context, images and credentials are never copied into this log.
      Turning logging off stops new logs; usage receipts, security audit and reviewed-edit history remain.</p>
    <label className="admin-check"><input type="checkbox" checked={citationWebSearch}
      onChange={event => setCitationWebSearch(event.currentTarget.checked)} />Allow web search for citations</label>
    <p className="admin-muted">Users must still accept AI terms, enable citation search and select retrieval providers.
      This does not enable autonomous web browsing or verify citations invented in ordinary chat.</p>
    <label className="admin-check"><input type="checkbox" checked={blockConfidentialTags}
      onChange={event => setBlockConfidentialTags(event.currentTarget.checked)} />Block owner-tagged confidential projects</label>
    <p className="admin-muted">Matches the owner's confidential tag, ignoring case and surrounding spaces.
      Explicit project confidentiality always blocks AI, even when this additional tag rule is off.</p>
    <div className="admin-row"><Button type="submit" variant="primary" busy={busy} disabled={!etag}>Save AI data policy</Button>
      <Button onClick={onRefresh} disabled={busy}>Refresh AI data policy</Button></div>
    {message && <p role="status">{message}</p>}
  </form>;
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
