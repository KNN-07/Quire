import { useCallback, useEffect, useId, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AuthOptions, createClient } from "@quire/contracts";
import { Button, Icon } from "../../ui";
import type { IconName } from "../../ui";
import { Notice, readInput, unwrap } from "./shared";
import type { AccountPageProps } from "./shared";
import { LdapSignIn } from "./ldap-sign-in";
import { OrganizationSignIn } from "./organization-sign-in";

export function useAuthOptions(client: ReturnType<typeof createClient>) {
  const [options, setOptions] = useState<AuthOptions | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async (signal?: AbortSignal) => {
    const result = unwrap(await client.call(endpoints.authOptions, readInput, signal));
    setOptions(result); setError("");
  }, [client]);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    });
    return () => controller.abort();
  }, [reload]);
  return { options, error, reload, setError };
}

function providerIcon(id: string): IconName {
  if (id.includes("github")) return "github";
  if (id.includes("google")) return "globe";
  if (id.includes("orcid")) return "user";
  if (id.includes("ldap")) return "server";
  if (id.includes("saml") || id.includes("oidc")) return "shield";
  return "key";
}

export function ProviderOptions({ client, availability, returnTo, onSessionChange, navigate, organizationDiscovery = false }: Pick<AccountPageProps, "onSessionChange" | "navigate"> & {
  readonly client: ReturnType<typeof createClient>;
  readonly availability: ReturnType<typeof useAuthOptions>;
  readonly returnTo: string;
  readonly organizationDiscovery?: boolean;
}) {
  const [screen, setScreen] = useState<"providers" | "organization" | "ldap">("providers");
  const idPrefix = useId();
  const { options, error } = availability;
  function selectProvider(provider: string) {
    if (provider === "ldap") { setScreen("ldap"); return; }
    location.assign(client.url(endpoints.identityStart, { params: { provider }, query: { returnTo }, body: undefined }).href);
  }
  if (screen === "ldap") {
    return <LdapSignIn client={client} onSessionChange={onSessionChange} navigate={navigate} returnTo={returnTo} onBack={() => setScreen("providers")} />;
  }
  if (screen === "organization") {
    return <OrganizationSignIn client={client} onBack={() => setScreen("providers")} onSelect={selectProvider} />;
  }
  const unavailable = options?.providers.filter(provider => !provider.capability.enabled) ?? [];
  const reason = (provider: AuthOptions["providers"][number]) => provider.capability.reason ?? `${provider.label} is ${provider.capability.state}.`;
  return <>{organizationDiscovery && <Button variant="primary" className="account-sso" onClick={() => setScreen("organization")}><Icon name="building" />Sign in with your organization</Button>}
    {error ? <><Notice error={error} message="" /><Button onClick={() => {
    void availability.reload().catch((cause: unknown) => { if (cause instanceof Error) availability.setError(cause.message); else throw cause; });
  }}>Reload sign-in options</Button></> : !options ? <p role="status">Loading sign-in options…</p> : options.providers.length === 0 ? <p className="account-muted">No external sign-in providers are configured.</p> : <>
    <div className="account-provider-grid">
      {options.providers.filter(provider => provider.capability.enabled).map(provider => <Button key={provider.id} onClick={() => selectProvider(provider.id)}><Icon name={providerIcon(provider.id)} />Continue with {provider.label}</Button>)}
    </div>
    {unavailable.length > 0 && <details className="account-unavailable">
      <summary>{unavailable.length === 1 ? "1 sign-in option unavailable" : `${unavailable.length} sign-in options unavailable`}</summary>
      <ul>{unavailable.map(provider => <li key={provider.id} id={`${idPrefix}-${provider.id}`}><strong>{provider.label}</strong> {reason(provider)}</li>)}</ul>
    </details>}
  </>}</>;
}
