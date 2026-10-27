import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AdapterGrant } from "@quire/contracts";
import { Button } from "../../ui";
import { listInput, Notice, Panel, unwrap, useAction } from "./shared";
import type { SettingsProps } from "./settings";
import { Credentials } from "./credentials";
import { PreferenceForm } from "./preferences";

export function GitSettings(props: SettingsProps) {
  const [connections, setConnections] = useState<readonly AdapterGrant[] | null>(null);
  const [error, setError] = useState("");
  const action = useAction();
  async function load(signal?: AbortSignal) { setConnections(unwrap(await props.client.call(endpoints.connectionsList, listInput, signal)).items); }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => { if (controller.signal.aborted) return; if (cause instanceof Error) setError(cause.message); else throw cause; });
    return () => controller.abort();
  }, [props.client]);
  return <>
    <Panel title="Git & integrations">
      {error ? <><Notice error={error} message="" /><Button onClick={() => { void action.run(async () => { await load(); setError(""); }); }}>Reload connections</Button></> : connections === null ? <p role="status">Loading connections…</p> : connections.length === 0 ? <p>No provider connections.</p> : <ul className="account-list">{connections.map(connection => <li key={connection.id}><div className="account-row"><span>{connection.label} · {connection.provider}<small>{connection.state}</small></span>
        <Button busy={action.busy} onClick={() => { void action.run(async () => {
          const result = unwrap(await props.client.call(endpoints.connectionTest, { params: { id: connection.id }, query: {}, body: { expectedVersion: connection.version } }));
          action.setMessage(result.ok ? `${connection.label}: connection test passed.` : result.reason ?? "Connection test failed.");
        }); }}>Test</Button>
        <Button variant="danger" busy={action.busy} onClick={() => { void action.run(async () => {
          unwrap(await props.client.call(endpoints.connectionDelete, { params: { id: connection.id }, query: {}, body: { expectedVersion: connection.version } })); await load();
        }); }}>Disconnect</Button>
      </div></li>)}</ul>}
      <p className="account-muted">Connection attempts use the configured adapter. An unavailable provider returns an error; no connection is created locally.</p>
      <div className="account-row">{["github", "gitlab", "zotero", "mendeley"].map(provider => <Button key={provider} busy={action.busy} onClick={() => { void action.run(async () => {
        const result = unwrap(await props.client.call(endpoints.connectionStart, { params: { provider }, query: {}, body: { returnTo: "/settings/git" } }));
        location.assign(result.url);
      }); }}>Connect {provider}</Button>)}</div>
      <Notice {...action} />
    </Panel>
    <Credentials {...props} /><PreferenceForm {...props} tab="git" />
  </>;
}
