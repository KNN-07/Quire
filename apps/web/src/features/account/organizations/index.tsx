import { useCallback, useEffect, useState } from "react";
import { endpoints, OrganizationSchema } from "@quire/contracts";
import type { Organization } from "@quire/contracts";
import { Button, Field } from "../../../ui";
import { listInput, mutationHeaders, Notice, Panel, Select, unwrap, useAction, value } from "../shared";
import type { SettingsProps } from "../settings";
import { OrganizationDetail } from "./organization";
import "./organizations.css";

export function Organizations(props: SettingsProps) {
  const [organizations, setOrganizations] = useState<readonly Organization[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false);
  const action = useAction();
  const load = useCallback(async (signal?: AbortSignal) => {
    const page = unwrap(await props.client.call(endpoints.organizationsList, listInput, signal));
    setOrganizations(page.items); setCursor(page.nextCursor); setLoaded(true);
  }, [props.client]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted && cause instanceof Error) action.setError(cause.message);
    });
    return () => controller.abort();
  }, [load, action.setError]);
  return <div className="account-stack organizations">
    <Panel title="Organizations">
      <p>Manage the teams and institutions available to your account. Organization roles are separate from installation operator access.</p>
      <Notice {...action} />
      {!loaded && !action.error && <p role="status">Loading organizations...</p>}
      {action.error && <Button onClick={() => { void action.run(() => load()); }}>Reload organizations</Button>}
      {loaded && organizations.length === 0 && <p>You do not belong to an organization yet.</p>}
      <div className="organizations-grid">{organizations.map(org => <button className="organization-card" key={org.id} aria-pressed={selected === org.id} onClick={() => setSelected(org.id)}>
        <strong>{org.name}</strong><span>{org.kind === "team" ? "Team" : "Institution"}</span><span>{org.domains.join(", ") || "No verified domains configured"}</span>
      </button>)}</div>
      {cursor && <Button busy={action.busy} onClick={() => { void action.run(async () => {
        const page = unwrap(await props.client.call(endpoints.organizationsList, { ...listInput, query: { limit: 200, cursor } }));
        setOrganizations(previous => [...previous, ...page.items]); setCursor(page.nextCursor);
      }); }}>Load more organizations</Button>}
      <details><summary>Create an organization</summary>
        <form className="account-form" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void action.run(async () => {
            const body = OrganizationSchema.unwrap().pick({ name: true, kind: true, domains: true }).parse({
              name: value(form, "name"), kind: value(form, "kind"), domains: value(form, "domains").split(",").map(domain => domain.trim()).filter(Boolean),
            });
            const org = unwrap(await props.client.call(endpoints.organizationCreate, { params: {}, query: {}, body, headers: mutationHeaders() }));
            await load(); setOrganizations(previous => previous.some(item => item.id === org.id) ? previous : [...previous, org]);
            setSelected(org.id); action.setMessage("Organization created.");
          });
        }}>
          <Field name="name" label="Organization name" required />
          <Select name="kind" label="Organization kind" defaultValue="team" options={[["team", "Team"], ["institution", "Institution"]]} />
          <Field name="domains" label="Domains (comma separated)" placeholder="example.edu" />
          <Button type="submit" variant="primary" busy={action.busy}>Create organization</Button>
        </form>
      </details>
    </Panel>
    {selected && <OrganizationDetail key={selected} {...props} organizationId={selected} />}
  </div>;
}
