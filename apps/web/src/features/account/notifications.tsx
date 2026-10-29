import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { NotificationPreferences, ResponseOf } from "@quire/contracts";
import { Button } from "../../ui";
import { Check, listInput, Notice, Panel, readInput, unwrap, useAction } from "./shared";
import type { SettingsProps } from "./settings";

export function Notifications(props: SettingsProps) {
  const [items, setItems] = useState<ResponseOf<typeof endpoints.notificationsList> | null>(null);
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [preferencesError, setPreferencesError] = useState("");
  const action = useAction();
  const eventNames = [
    ["mention", "Someone mentions me"], ["share", "A project is shared with me"],
    ["project.access.requested", "Someone requests access to my project"],
    ["organization.ai.changed", "My organization changes its AI policy"],
    ["compile.failed", "A pushed commit fails to compile"], ["suggestion", "Suggested changes"],
    ["digest", "Weekly project digest"],
  ] as const;
  async function load(signal?: AbortSignal) { setItems(unwrap(await props.client.call(endpoints.notificationsList, listInput, signal))); }
  async function loadPreferences(signal?: AbortSignal) {
    setPreferences(unwrap(await props.client.call(endpoints.notificationPreferencesGet, readInput, signal))); setPreferencesError("");
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => { if (controller.signal.aborted) return; if (cause instanceof Error) setError(cause.message); else throw cause; });
    void loadPreferences(controller.signal).catch((cause: unknown) => { if (controller.signal.aborted) return; if (cause instanceof Error) setPreferencesError(cause.message); else throw cause; });
    return () => controller.abort();
  }, [props.client]);
  return <Panel title="Notifications">
    {preferencesError ? <><Notice error={preferencesError} message="" /><Button onClick={() => { void action.run(async () => { await loadPreferences(); }); }}>Reload notification preferences</Button></> : !preferences ? <p role="status">Loading notification preferences…</p> : <form key={preferences.version} className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        const names = [...new Set([...eventNames.map(([name]) => name), ...Object.keys(preferences.events)])];
        unwrap(await props.client.call(endpoints.notificationPreferences, { params: {}, query: {}, body: {
          events: Object.fromEntries(names.map(name => [name, form.has(`event:${name}`)])),
          channels: [...(form.has("in-app") ? ["in-app" as const] : []), ...(form.has("email") ? ["email" as const] : [])],
          projectOverrides: Object.fromEntries(Object.entries(preferences.projectOverrides).map(([id, events]) => [id, Object.fromEntries(Object.keys(events).map(name => [name, form.has(`project:${id}:${name}`)]))])),
          expectedVersion: preferences.version,
        } }));
        await loadPreferences(); action.setMessage("Notification preferences saved.");
      });
    }}>
      <fieldset disabled={action.busy}>
        {[...new Set([...eventNames.map(([name]) => name), ...Object.keys(preferences.events)])].map(name => <Check key={name} name={`event:${name}`} label={eventNames.find(([id]) => id === name)?.[1] ?? name} checked={preferences.events[name] ?? true} />)}
        <h3>Delivery channels</h3><Check name="in-app" label="In app" checked={preferences.channels.includes("in-app")} /><Check name="email" label="Email" checked={preferences.channels.includes("email")} />
        {Object.entries(preferences.projectOverrides).map(([id, events]) => <fieldset key={id}><legend>Project {id} overrides</legend>{Object.entries(events).map(([name, enabled]) => <Check key={name} name={`project:${id}:${name}`} label={name} checked={enabled} />)}</fieldset>)}
        <Button type="submit" variant="primary" busy={action.busy}>Save changes</Button>
      </fieldset>
    </form>}
    <Notice {...action} />
    {action.error && <Button onClick={() => { void action.run(async () => { await loadPreferences(); }); }}>Reload current notification preferences</Button>}
    <h3>Recent notifications</h3>
    {error ? <><Notice error={error} message="" /><Button onClick={() => { void action.run(async () => { await load(); setError(""); }); }}>Reload notifications</Button></> : !items ? <p role="status">Loading notifications…</p> : items.items.length === 0 ? <p>No notifications yet.</p> : <ul className="account-list">{items.items.map(item => <li key={item.id}><div className="account-row"><span>{item.kind}<small>{new Date(item.createdAt).toLocaleString()}</small></span>{item.read ? <span>Read</span> : <Button busy={action.busy} onClick={() => { void action.run(async () => {
      unwrap(await props.client.call(endpoints.notificationRead, { params: { id: item.id }, query: {}, body: { expectedVersion: item.version } })); await load();
    }); }}>Mark read</Button>}</div></li>)}</ul>}
  </Panel>;
}
