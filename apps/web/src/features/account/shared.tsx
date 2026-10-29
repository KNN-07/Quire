import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { createClient, Result } from "@quire/contracts";
import { Button } from "../../ui";

export type AccountPageProps = {
  readonly path: string;
  readonly client: ReturnType<typeof createClient>;
  readonly navigate: (path: string) => void;
  readonly onSessionChange: () => Promise<void>;
};
export const readInput = { params: {}, query: {}, body: undefined } as const;
export const listInput = { params: {}, query: { limit: 200 }, body: undefined } as const;
export const mutationHeaders = () => ({ "idempotency-key": crypto.randomUUID() });
export function value(form: FormData, name: string): string {
  const item = form.get(name);
  return typeof item === "string" ? item : "";
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (cause) {
      if (cause instanceof Error) setError(cause.message);
      else throw cause;
    } finally { setBusy(false); }
  }
  return { busy, message, error, run, setMessage, setError };
}
export function unwrap<T>(result: Result<T>): T {
  if ("error" in result) throw new AccountRequestError(result.error.code, result.error.message);
  return result.data;
}
class AccountRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AccountRequestError"; }
}
/** Operator-facing configuration requirements stay available without dominating the page. */
export function Requirement({ reason, summary = "Why is this unavailable?" }: { readonly reason: string; readonly summary?: string }) {
  return <details className="account-requirement"><summary>{summary}</summary><p>{reason}</p></details>;
}
export function Notice({ error, message }: { readonly error: string; readonly message: string }) {
  return <>{error && <p role="alert" className="account-error">{error}</p>}{message && <p role="status" className="account-notice">{message}</p>}</>;
}
export function Select({ label, name, options, defaultValue }: {
  readonly label: string; readonly name: string; readonly options: readonly (readonly [string, string])[]; readonly defaultValue: string;
}) {
  return <label className="q-field"><span className="q-field__label">{label}</span><select className="q-input" name={name} defaultValue={defaultValue}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
}
export function Check({ label, name, checked }: { readonly label: string; readonly name: string; readonly checked: boolean }) {
  return <label className="account-check"><span>{label}</span><input type="checkbox" name={name} defaultChecked={checked} /></label>;
}
export function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <section className="account-panel"><h2>{title}</h2>{children}</section>;
}
export function SaveBar({ busy, cancel }: { readonly busy: boolean; readonly cancel: () => void }) {
  return <div className="account-actions"><Button onClick={cancel}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save changes</Button></div>;
}
export function OfflineNotice() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online ? null : <p role="alert" className="account-error">You are offline. Reconnect before saving account changes.</p>;
}
