import { useCallback, useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { AppHeader, Button, Icon } from "../../ui";
import { Notice, readInput, unwrap } from "./shared";
import type { AccountPageProps } from "./shared";
import { Profile } from "./profile";
import { PreferenceForm } from "./preferences";
import { Security } from "./security";
import { GitSettings } from "./git";
import { Notifications } from "./notifications";
import { Billing } from "./billing";
import { Organizations } from "./organizations";

export type SettingsProps = AccountPageProps & {
  readonly account: ResponseOf<typeof endpoints.me>;
  readonly userVersion: number | null;
  readonly refresh: () => Promise<void>;
};
const tabs = [["profile", "Profile", "user"], ["security", "Sign-in & SSO", "lock"], ["editor", "Editor", "code"], ["ai", "AI assistant", "sparkle"], ["git", "Git & integrations", "branch"], ["notifications", "Notifications", "bell"], ["billing", "Billing", "card"], ["organizations", "Organizations", "building"]] as const;
export function Settings(props: AccountPageProps) {
  const [account, setAccount] = useState<ResponseOf<typeof endpoints.me> | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await props.client.callWithMetadata(endpoints.me, readInput, signal);
    setAccount(unwrap(result.result)); setVersion(result.metadata.expectedVersion);
  }, [props.client]);
  const refresh = useCallback(async () => { await load(); }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof Error) setError(cause.message); else throw cause;
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  const requestedTab = new URL(props.path, location.origin).pathname.split("/")[2] ?? "profile";
  const tab = requestedTab === "notif" ? "notifications" : requestedTab === "identities" ? "security" : requestedTab;
  const settingsProps = account ? { ...props, account, userVersion: version, refresh } : null;
  return <>
    <AppHeader className="account-header" actions={account && <span className="account-header__avatar" title={account.user.name} aria-hidden="true">{account.user.name.trim().split(/\s+/u).slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toLocaleUpperCase()}</span>}>
      <a href="/projects" className="account-back" onClick={event => { event.preventDefault(); props.navigate("/projects"); }}><Icon name="arrowLeft" size={14} />Back to projects</a></AppHeader>
    <div className="account-shell">
      <nav className="account-nav" aria-label="Settings sections"><h1>Settings</h1>{tabs.map(([id, label, icon]) => <a key={id} href={`/settings/${id}`} aria-current={tab === id ? "page" : undefined} onClick={event => { event.preventDefault(); props.navigate(`/settings/${id}`); }}><Icon name={icon} />{label}</a>)}</nav>
      <main key={tab} className="account-main account-stack">
        {loading && <p role="status">Loading account settings…</p>}
        {error && <><Notice error={error} message="" /><Button onClick={() => {
          setError(""); setLoading(true);
          void refresh().catch((cause: unknown) => { if (cause instanceof Error) setError(cause.message); else throw cause; }).finally(() => setLoading(false));
        }}>Retry loading account</Button><a href="/sign-in">Sign in</a></>}
        {settingsProps && (tab === "profile" ? <Profile {...settingsProps} /> : tab === "editor" || tab === "ai" ? <PreferenceForm {...settingsProps} tab={tab} /> : tab === "security" ? <Security {...settingsProps} /> : tab === "git" ? <GitSettings {...settingsProps} /> : tab === "notifications" ? <Notifications {...settingsProps} /> : tab === "billing" ? <Billing {...settingsProps} /> : tab === "organizations" ? <Organizations {...settingsProps} /> : <><h2>Settings section not found</h2><a href="/settings/profile">Open profile settings</a></>)}
      </main>
    </div>
  </>;
}
