import { useCallback, useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { AuthOptions, createClient } from "@quire/contracts";
import { Button } from "../../ui";
import { Notice, readInput, unwrap } from "./shared";

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

export function ProviderOptions({ client, availability, returnTo }: {
  readonly client: ReturnType<typeof createClient>;
  readonly availability: ReturnType<typeof useAuthOptions>;
  readonly returnTo: string;
}) {
  const { options, error } = availability;
  return <>{error ? <><Notice error={error} message="" /><Button onClick={() => {
    void availability.reload().catch((cause: unknown) => { if (cause instanceof Error) availability.setError(cause.message); else throw cause; });
  }}>Reload sign-in options</Button></> : !options ? <p role="status">Loading sign-in options…</p> : options.providers.length === 0 ? <p className="account-muted">No external sign-in providers are configured.</p> : <div className="account-stack">
    {options.providers.map(provider => <div key={provider.id} className="account-stack">
      <Button disabled={!provider.capability.enabled} onClick={() => {
        location.assign(client.url(endpoints.identityStart, { params: { provider: provider.id }, query: { returnTo }, body: undefined }).href);
      }}>Continue with {provider.label}</Button>
      {!provider.capability.enabled && <p className="account-muted">{provider.capability.reason ?? `${provider.label} is ${provider.capability.state}.`}</p>}
    </div>)}
  </div>}</>;
}
