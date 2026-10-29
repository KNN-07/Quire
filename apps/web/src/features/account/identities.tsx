import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { LinkedIdentity } from "@quire/contracts";
import { Button } from "../../ui";
import { listInput, Notice, Requirement, unwrap, useAction } from "./shared";
import type { SettingsProps } from "./settings";
import { useAuthOptions } from "./auth-options";

export function LinkedIdentities(props: SettingsProps) {
  const [identities, setIdentities] = useState<readonly LinkedIdentity[] | null>(null);
  const version = props.userVersion;
  const [error, setError] = useState("");
  const action = useAction();
  const availability = useAuthOptions(props.client);
  async function load(signal?: AbortSignal) {
    const response = await props.client.call(endpoints.identitiesList, listInput, signal);
    setIdentities(unwrap(response).items); setError("");
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    });
    return () => controller.abort();
  }, [props.client]);
  return <div className="account-stack account-identities">
    <h3>Linked identities</h3>
    {error ? <><Notice error={error} message="" /><Button onClick={() => { void action.run(async () => { await load(); }); }}>Reload linked identities</Button></> : identities === null ? <p role="status">Loading linked identities…</p> : identities.length === 0 ? <p>No linked identities. You can link an enabled provider below.</p> : <ul className="account-list">{identities.map(identity => <li key={identity.id}>
      <div className="account-row"><span>{identity.issuer}<small>{identity.subject} · Linked {new Date(identity.createdAt).toLocaleDateString()}</small></span>
        <Button disabled={version === null} busy={action.busy} onClick={() => { void action.run(async () => {
          if (version === null) return;
          unwrap(await props.client.call(endpoints.identityUnlink, { params: { id: identity.id }, query: {}, body: { expectedVersion: version } }));
          location.assign("/sign-in");
        }); }}>Unlink {identity.issuer}</Button>
      </div>
    </li>)}</ul>}
    {availability.error && <Notice error={availability.error} message="" />}
    {!availability.options && !availability.error && <p role="status">Loading provider availability…</p>}
    {availability.options?.providers.map(provider => <div key={provider.id} className="account-row">
      <span>{provider.label}{!provider.capability.enabled && (provider.capability.reason && provider.capability.reason.length > 40
        ? <Requirement reason={provider.capability.reason} summary="Not configured" />
        : <small>{provider.capability.reason ?? provider.capability.state}</small>)}</span>
      <Button disabled={!provider.capability.enabled || version === null} busy={action.busy} onClick={() => { void action.run(async () => {
        if (version === null) return;
        const response = await props.client.callWithMetadata(endpoints.identityLink, { params: { provider: provider.id }, query: {}, body: { expectedVersion: version } });
        unwrap(response.result);
        const redirect = response.metadata.headers["location"];
        if (!redirect) throw new Error("Identity provider authorization redirect was not returned.");
        location.assign(redirect);
      }); }}>Link {provider.label}</Button>
    </div>)}
    {availability.options?.passwordEnabled ? <a href="/reset-password">Reset your password</a> : availability.options && <p>Password sign-in is disabled by this server.</p>}
    <Notice {...action} />
  </div>;
}
