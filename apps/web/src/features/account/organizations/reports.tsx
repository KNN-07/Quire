import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Organization, ResponseOf } from "@quire/contracts";
import { Button, Field } from "../../../ui";
import { mutationHeaders, Notice, unwrap, useAction, value } from "../shared";
import type { SettingsProps } from "../settings";

export function OrganizationReports({ client, organization, admin }: SettingsProps & { readonly organization: Organization; readonly admin: boolean }) {
  const [metrics, setMetrics] = useState<ResponseOf<typeof endpoints.organizationMetrics> | null>(null);
  const [audit, setAudit] = useState<ResponseOf<typeof endpoints.organizationAudit> | null>(null);
  const [operation, setOperation] = useState<ResponseOf<typeof endpoints.organizationAuditExport> | null>(null);
  const action = useAction();
  return <div className="account-stack">
    <h3>Usage metrics</h3>
    <p>Native counts for the selected UTC interval. Storage counts files created in that interval, not all current storage.</p>
    <form className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        setMetrics(unwrap(await client.call(endpoints.organizationMetrics, { params: { o: organization.id }, query: { from: new Date(value(form, "from")).toISOString(), to: new Date(value(form, "to")).toISOString() }, body: undefined })));
      });
    }}>
      <Field label="From (UTC)" name="from" type="date" required defaultValue={new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)} />
      <Field label="To (UTC, inclusive day start)" name="to" type="date" required defaultValue={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} />
      <Button type="submit" busy={action.busy}>Load metrics</Button>
    </form>
    {metrics && <dl className="organization-metrics">{([["Active users", metrics.activeUsers], ["Active projects", metrics.activeProjects], ["Compiles", metrics.compileCount], ["Compile time (ms)", metrics.compileMs], ["Storage created (bytes)", metrics.storageBytes], ["AI uses", metrics.aiUses]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>}
    {admin && <>
      <h3>Audit history</h3>
      <div className="account-actions"><Button busy={action.busy} onClick={() => { void action.run(async () => {
        setAudit(unwrap(await client.call(endpoints.organizationAudit, { params: { o: organization.id }, query: { limit: 50 }, body: undefined })));
      }); }}>Load audit history</Button>
        <Button busy={action.busy} onClick={() => { void action.run(async () => {
          setOperation(unwrap(await client.call(endpoints.organizationAuditExport, { params: { o: organization.id }, query: {}, body: {}, headers: mutationHeaders() })));
        }); }}>Export audit ZIP</Button>
      </div>
      {audit && <>{audit.items.length === 0 && <p>No audit entries.</p>}<ol className="account-list organization-audit">{audit.items.map(entry => <li key={entry.id}><strong>{entry.event}</strong><span>{entry.at}</span><code>Actor: {entry.actorId ?? "System"} / Target: {entry.targetId}</code><code>{JSON.stringify(entry.details)}</code></li>)}</ol>
        {audit.nextCursor && <Button busy={action.busy} onClick={() => { void action.run(async () => {
          const page = unwrap(await client.call(endpoints.organizationAudit, { params: { o: organization.id }, query: { limit: 50, cursor: audit.nextCursor ?? undefined }, body: undefined }));
          setAudit({ items: [...audit.items, ...page.items], nextCursor: page.nextCursor });
        }); }}>Load more audit entries</Button>}</>}
      {operation && <div role="status">Audit export {operation.status}. {operation.errorCode}
        {operation.status === "succeeded" && operation.result?.["format"] === "zip" && <a download="audit.zip" href={`/api/operations/${encodeURIComponent(operation.id)}/download`}>Download audit ZIP</a>}
      </div>}
    </>}
    <Notice {...action} />
  </div>;
}
