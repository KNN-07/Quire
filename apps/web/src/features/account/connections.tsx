import { useCallback, useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AdapterGrant, ResponseOf } from "@quire/contracts";
import { Button } from "../../ui";
import { Notice, Panel, readInput, unwrap, useAction } from "./shared";
import type { AccountPageProps } from "./shared";
import { ConnectionForm } from "./connection-forms";
import type { CredentialProvider } from "./connection-forms";

const providers = [
  ["github", "GitHub"], ["gitlab", "GitLab"], ["zotero", "Zotero"],
  ["mendeley", "Mendeley"], ["dropbox", "Dropbox"], ["git", "Generic Git"],
] as const;

/** Fetch complete current grants for version-sensitive actions and scope selectors. */
export async function currentConnections(client: AccountPageProps["client"], signal?: AbortSignal) {
  const items: AdapterGrant[] = [];
  let cursor: string | null = null;
  do {
    const page: ResponseOf<typeof endpoints.connectionsList> = unwrap(await client.call(endpoints.connectionsList, {
      params: {}, query: { limit: 200, ...(cursor ? { cursor } : {}) }, body: undefined,
    }, signal));
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

export function Connections({ client }: Pick<AccountPageProps, "client">) {
  const [availability, setAvailability] = useState<ResponseOf<typeof endpoints.connectionAvailability> | null>(null);
  const [connections, setConnections] = useState<readonly AdapterGrant[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<CredentialProvider | null>(null);
  const [removing, setRemoving] = useState<AdapterGrant | null>(null);
  const action = useAction();
  const load = useCallback(async (signal?: AbortSignal) => {
    const [configured, page] = await Promise.all([
      client.call(endpoints.connectionAvailability, readInput, signal),
      client.call(endpoints.connectionsList, { params: {}, query: { limit: 20 }, body: undefined }, signal),
    ]);
    setAvailability(unwrap(configured));
    const grants = unwrap(page);
    setConnections(grants.items); setNext(grants.nextCursor); setError("");
  }, [client]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    });
    return () => controller.abort();
  }, [load]);
  return <div className="connection-settings"><Panel title="Git & integrations">
    <p className="account-muted">Connect remotes and reference managers, and manage credentials for the Git CLI.</p>
    {error && <Notice error={error} message="" />}
    <Button disabled={action.busy} onClick={() => { void action.run(() => load()); }}>Reload connections</Button>
    {!availability && !error && <p role="status">Loading provider availability...</p>}
    {availability && <ul className="account-list connection-providers" aria-label="Connection providers">
      {providers.map(([provider, label]) => {
        const capability = availability[provider];
        return <li key={provider}>
          <div className="account-row"><span><strong>{label}</strong><small>{capability?.enabled ? "Configured" : capability?.state ?? "Not installed"}</small></span>
            <Button disabled={action.busy || !capability?.enabled} aria-expanded={provider === "zotero" || provider === "git" ? form === provider : undefined} onClick={() => {
              switch (provider) {
                case "zotero": case "git": setForm(provider); break;
                case "github": case "gitlab": case "mendeley": case "dropbox":
                  void action.run(async () => {
                    const result = unwrap(await client.call(endpoints.connectionStart, {
                      params: { provider }, query: {}, body: { returnTo: "/settings/git" },
                    }));
                    location.assign(result.url);
                  }); break;
              }
            }}>Connect {label}</Button>
          </div>
          {capability?.reason && <p className="connection-requirements">{capability.reason}</p>}
          {!capability && <p className="connection-requirements">This provider is not installed in this application.</p>}
          {form === provider && <ConnectionForm client={client} provider={form} saved={() => load()} cancel={() => setForm(null)} />}
        </li>;
      })}
    </ul>}
    <h3>Saved connections</h3>
    {connections === null && !error ? <p role="status">Loading connections...</p> : connections?.length === 0
      ? <p>No saved connections. Configure a provider, then connect it above.</p>
      : <ul className="account-list connection-grants" aria-label="Saved connections">{connections?.map(connection => <li key={connection.id}>
        <div className="account-row"><span><strong>{connection.label}</strong><small>{providers.find(([id]) => id === connection.provider)?.[1] ?? connection.provider} · {connection.state === "ready" ? "Connected" : connection.state === "disabled" ? "Disconnected" : connection.state} · Version {connection.version}</small></span>
          <Button disabled={action.busy || connection.state !== "ready"} onClick={() => { void action.run(async () => {
            const current = (await currentConnections(client)).find(grant => grant.id === connection.id);
            if (!current) { await load(); action.setError("Connection no longer exists. Select a current connection."); return; }
            const result = unwrap(await client.call(endpoints.connectionTest, { params: { id: current.id }, query: {}, body: { expectedVersion: current.version } }));
            await load();
            action.setMessage(result.ok ? `${connection.label}: connection test passed.` : result.reason ?? "Connection test failed.");
          }); }}>Test {connection.label}</Button>
          <Button variant="danger" disabled={action.busy || connection.state !== "ready"} onClick={() => setRemoving(connection)}>
            {connection.provider === "git" ? `Forget ${connection.label}` : `Disconnect ${connection.label}`}
          </Button>
        </div>
        {removing?.id === connection.id && <div className="connection-confirm" onKeyDown={event => { if (event.key === "Escape") setRemoving(null); }}>
          <p>{connection.provider === "git"
            ? "Forget this repository credential locally? The independently managed upstream credential remains valid."
            : connection.provider === "zotero"
              ? "Revoke the dedicated key in Zotero account API-key settings first, then disconnect here. Quire will not delete your user-created key."
              : "Disconnect this provider grant? The adapter must complete provider revocation before Quire clears the stored credential."}</p>
          <div className="account-row"><Button disabled={action.busy} onClick={() => setRemoving(null)}>Cancel removal</Button>
            <Button variant="danger" disabled={action.busy} onClick={() => { void action.run(async () => {
              const current = (await currentConnections(client)).find(grant => grant.id === connection.id);
              if (!current) { await load(); setRemoving(null); return; }
              unwrap(await client.call(endpoints.connectionDelete, { params: { id: current.id }, query: {}, body: { expectedVersion: current.version } }));
              setRemoving(null); await load();
              action.setMessage(connection.provider === "git" ? "Saved credential forgotten locally. Upstream credential was not revoked." : "Connection disconnected.");
            }); }}>{connection.provider === "git" ? "Forget saved credential" : "Confirm disconnect"}</Button>
          </div>
        </div>}
      </li>)}</ul>}
    {next && <Button disabled={action.busy} onClick={() => { void action.run(async () => {
      const page = unwrap(await client.call(endpoints.connectionsList, { params: {}, query: { limit: 20, cursor: next }, body: undefined }));
      setConnections(previous => [...(previous ?? []), ...page.items]); setNext(page.nextCursor);
    }); }}>Load more connections</Button>}
    <Notice {...action} />
  </Panel></div>;
}
