import { useState } from "react";
import { endpoints, IdentityConfigSchema, IdSchema } from "@quire/contracts";
import type { IdentityConfig } from "@quire/contracts";
import { Button, Field, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { useAdminResource } from "./useAdminResource";

export function IdentityAccess({ client, config, onChange }: {
  readonly client: AdminClient; readonly config: IdentityConfig; readonly onChange: (config: IdentityConfig) => void;
}) {
  const [q, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const operators = useAdminResource(client, endpoints.adminUsersList, {
    params: {}, query: { q, cursor, role: "operator", state: "active", limit: 50 }, body: undefined,
  });
  const mappingSchema = IdentityConfigSchema.unwrap().shape.mappings.unwrap().element.unwrap();
  return <>
    <fieldset><legend>Recovery operator</legend>
      <Field label="Find operator" value={q} onChange={event => { setQuery(event.currentTarget.value); setCursor(undefined); }} />
      {operators.error ? <p role="alert">{operators.error}</p> : operators.loading ? <Spinner label="Loading operators" /> : <>
        <label className="admin-label">Break-glass account<select value={config.breakGlassUserId}
          onChange={event => onChange({ ...config, breakGlassUserId: IdSchema.parse(event.currentTarget.value) })}>
          {!operators.resource?.data.items.some(user => user.id === config.breakGlassUserId) &&
            <option value={config.breakGlassUserId}>Current recovery account</option>}
          {operators.resource?.data.items.map(user => <option key={user.id} value={user.id}>{user.name} ({user.primaryEmail})</option>)}
        </select></label>
        <div className="admin-row">{cursor && <Button type="button" onClick={() => setCursor(undefined)}>First operators</Button>}
          {operators.resource?.data.nextCursor && <Button type="button" onClick={() => setCursor(operators.resource?.data.nextCursor ?? undefined)}>More operators</Button>}</div>
      </>}
      <p>The server must verify that this account has a working password before enforcing SSO.</p>
    </fieldset>
    <fieldset><legend>Group mappings</legend>
      {config.mappings.map((mapping, index) => <div className="admin-settings-grid" key={index}>
        <Field label="Provider group" required value={mapping.group} onChange={event => onChange({
          ...config, mappings: config.mappings.map((item, i) => i === index ? { ...item, group: event.currentTarget.value } : item),
        })} />
        <label className="admin-label">Role<select value={mapping.role} onChange={event => onChange({
          ...config, mappings: config.mappings.map((item, i) => i === index ? { ...item, role: mappingSchema.shape.role.parse(event.currentTarget.value) } : item),
        })}>{["admin", "manager", "member", "guest"].map(role => <option key={role} value={role}>{role}</option>)}</select></label>
        <label className="admin-label">AI access<select value={mapping.ai} onChange={event => onChange({
          ...config, mappings: config.mappings.map((item, i) => i === index ? { ...item, ai: mappingSchema.shape.ai.parse(event.currentTarget.value) } : item),
        })}>{["off", "ask", "agent"].map(mode => <option key={mode} value={mode}>{mode}</option>)}</select></label>
        <Button type="button" onClick={() => onChange({ ...config, mappings: config.mappings.filter((_, i) => i !== index) })}>Remove mapping</Button>
      </div>)}
      <Button type="button" onClick={() => onChange({ ...config, mappings: [...config.mappings, { group: "", role: "member", ai: "off" }] })}>Add group mapping</Button>
    </fieldset>
  </>;
}
