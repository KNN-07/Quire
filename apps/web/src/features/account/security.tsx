import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Operation, Session } from "@quire/contracts";
import { Button, Field, Modal, RelativeTime } from "../../ui";
import { listInput, mutationHeaders, Notice, Panel, unwrap, useAction, value } from "./shared";
import type { SettingsProps } from "./settings";
import { LinkedIdentities } from "./identities";
import { AccountManagement } from "./management";

/** A readable "Browser on OS" label; the raw user agent stays in the tooltip. */
function describeDevice(agent: string): string {
  if (!agent) return "Unknown device";
  const browser = /Edg\//u.test(agent) ? "Edge" : /Firefox\//u.test(agent) ? "Firefox" : /HeadlessChrome\//u.test(agent) ? "Headless Chrome"
    : /Chrome\//u.test(agent) ? "Chrome" : /Safari\//u.test(agent) ? "Safari" : null;
  const system = /Android/u.test(agent) ? "Android" : /iPhone|iPad/u.test(agent) ? "iOS" : /Windows/u.test(agent) ? "Windows"
    : /Mac OS X/u.test(agent) ? "macOS" : /Linux/u.test(agent) ? "Linux" : null;
  return browser && system ? `${browser} on ${system}` : browser ?? system ?? agent;
}
export function Security(props: SettingsProps) {
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [sessionError, setSessionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exportJob, setExportJob] = useState<Operation | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useAction();
  async function loadSessions(signal?: AbortSignal) {
    const response = await props.client.call(endpoints.sessionList, listInput, signal);
    const page = unwrap(response); setSessions(page.items);
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadSessions(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof Error) setSessionError(error.message); else throw error;
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.client]);
  return <Panel title="Sign-in & SSO">
    <LinkedIdentities {...props} />
    <AccountManagement {...props} />
    <h3>Active sessions</h3>
    {loading && <p role="status">Loading sessions…</p>}
    {sessionError && <><Notice error={sessionError} message="" /><Button onClick={() => { void action.run(async () => { await loadSessions(); setSessionError(""); }); }}>Reload sessions</Button></>}
    {!loading && !sessionError && sessions.length === 0 && <p>No active sessions were returned. Sign in again if this is unexpected.</p>}
    <ul className="account-list">{sessions.map(session => <li key={session.id}>
      <div className="account-row"><span title={session.userAgent || undefined}>{describeDevice(session.userAgent)}{session.current ? " · This session" : ""}<small>{session.ip ?? "IP not recorded"} · Last active <RelativeTime value={session.lastSeenAt} /></small></span>
        {session.current && <Button busy={action.busy} onClick={() => { void action.run(async () => {
          unwrap(await props.client.call(endpoints.authLogout, { params: {}, query: {}, body: {} }));
          await props.onSessionChange(); props.navigate("/sign-in");
        }); }}>Sign out</Button>}
        {!session.current && <Button busy={action.busy} onClick={() => { void action.run(async () => {
          unwrap(await props.client.call(endpoints.sessionDelete, { params: { id: session.id }, query: {}, body: { expectedVersion: session.version } }));
          await loadSessions(); action.setMessage("Session revoked.");
        }); }}>Revoke session</Button>}
      </div>
    </li>)}</ul>
    <Button disabled={sessions.every(session => session.current)} busy={action.busy} onClick={() => { void action.run(async () => {
      unwrap(await props.client.call(endpoints.sessionRevokeOthers, { params: {}, query: {}, body: {} }));
      await loadSessions(); action.setMessage("Other sessions revoked.");
    }); }}>Sign out other sessions</Button>
    <Notice {...action} />
    <h3>Export account data</h3>
    <Button busy={action.busy} onClick={() => { void action.run(async () => {
      setExportJob(unwrap(await props.client.call(endpoints.accountExport, { params: {}, query: {}, body: {}, headers: mutationHeaders() })));
    }); }}>Request account export</Button>
    {exportJob && <div className="account-stack"><p role="status">Export: {exportJob.status}{exportJob.errorCode ? ` · ${exportJob.errorCode}` : ""}</p>
      {exportJob.status === "succeeded" && exportJob.result !== null ? <Button onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(exportJob.result, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "quire-account.json"; link.click(); URL.revokeObjectURL(url);
      }}>Download account data</Button> : <Button busy={action.busy} onClick={() => { void action.run(async () => {
        setExportJob(unwrap(await props.client.call(endpoints.operationGet, { params: { id: exportJob.id }, query: {}, body: undefined })));
      }); }}>Refresh export status</Button>}
    </div>}
    <h3>Delete account</h3>
    <p className="account-muted">Transfer or delete your remaining owned projects first, including archived or trashed projects.
      Already-deleted projects do not need reassignment. Each organization must retain another active administrator.</p>
    <p className="account-muted">Account deletion does not cancel organization subscriptions. Manage billing separately before leaving.
      Retained project history and operator backups are not securely erased by this action.</p>
    {props.account.user.managedBy !== null && <p>Your organization controls deletion while your account is managed.</p>}
    <Button variant="danger" disabled={props.account.user.managedBy !== null} onClick={() => setConfirmDelete(true)}>Delete account…</Button>
    <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete your account">
      <form className="account-form" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }} onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        if (value(form, "confirmation") !== props.account.user.primaryEmail) { action.setError("Enter your primary email to confirm."); return; }
        void action.run(async () => {
          if (props.userVersion === null) { action.setError("Missing account version. Reload settings."); return; }
          unwrap(await props.client.call(endpoints.accountDelete, { params: {}, query: {}, body: { confirmation: value(form, "confirmation"), password: value(form, "password"), expectedVersion: props.userVersion } }));
          await props.onSessionChange(); props.navigate("/sign-in");
        });
      }}>
        <p>This removes account access and credentials. Existing owned projects must be transferred or deleted first.
          Organization billing is not canceled. Enter {props.account.user.primaryEmail} to confirm.</p>
        <Field label="Confirmation email" name="confirmation" required autoComplete="off" />
        <Field label="Current password" name="password" type="password" autoComplete="current-password" />
        <Notice {...action} /><div className="account-actions"><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button type="submit" variant="danger" busy={action.busy} onKeyDown={event => { if (event.key === "Enter") event.stopPropagation(); }}>Permanently delete account</Button></div>
      </form>
    </Modal>
  </Panel>;
}
