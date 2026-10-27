import { useState } from "react";
import { endpoints, DigestSchema, IdSchema } from "@quire/contracts";
import type { Id, Operation } from "@quire/contracts";
import { Button, EmptyState, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { downloadBytes, errorMessage } from "./api";
import { DataView } from "./DataView";
import { useAdminResource } from "./useAdminResource";

export function Support({ client, path, navigate }: {
  readonly client: AdminClient; readonly path: string; readonly navigate: (path: string) => void;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const operations = useAdminResource(client, endpoints.operationsList, { params: {}, query: { cursor, limit: 50 }, body: undefined });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requested = new URL(path, window.location.origin).searchParams.get("operation");
  const selected = IdSchema.safeParse(requested);
  async function generate() {
    setBusy(true); setError("");
    try {
      const result = await client.call(endpoints.diagnosticsCreate, {
        params: {}, query: {}, body: {}, headers: { "idempotency-key": key },
      });
      if ("error" in result) setError(result.error.message);
      else {
        setKey(crypto.randomUUID()); setCursor(undefined); operations.refresh();
        navigate(`/admin/support?operation=${result.data.id}`);
      }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="admin-support-title">
    <div className="admin-row admin-page-heading"><h1 id="admin-support-title">Support</h1>
      <Button variant="primary" busy={busy} onClick={() => void generate()}>Generate diagnostics</Button></div>
    <p className="admin-muted">Generate a redacted diagnostic bundle and inspect your background operations. Creating a bundle does not send it to a support provider.</p>
    {error && <p role="alert">{error}</p>}
    {selected.success ? <OperationDetails key={selected.data} client={client} id={selected.data} />
      : requested && <p role="alert">This operation link is invalid.</p>}
    <div className="admin-row"><h2>Recent operations</h2><Button onClick={operations.refresh}>Refresh</Button></div>
    {operations.error ? <p role="alert">{operations.error}</p> : operations.loading ? <Spinner label="Loading operations" />
      : operations.resource?.data.items.length ? <div className="admin-user-table"><table className="admin-table">
        <thead><tr><th>Operation</th><th>Created</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead>
        <tbody>{operations.resource.data.items.map(operation => <tr key={operation.id}>
          <td data-label="Operation">{operation.kind}</td>
          <td data-label="Created"><time dateTime={operation.createdAt}>{new Date(operation.createdAt).toLocaleString()}</time></td>
          <td data-label="Status">{operation.status}</td><td data-label="Progress">{Math.round(operation.progress * 100)}%</td>
          <td data-label="Actions"><Button size="small" onClick={() => navigate(`/admin/support?operation=${operation.id}`)}>View details</Button></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="No operations yet" description="Diagnostic generation, exports and administration tasks will appear here." />}
    <div className="admin-row">{cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
      {operations.resource?.data.nextCursor && <Button onClick={() => setCursor(operations.resource?.data.nextCursor ?? undefined)}>Next page</Button>}</div>
  </section>;
}

function OperationDetails({ client, id }: { readonly client: AdminClient; readonly id: Id }) {
  const operation = useAdminResource(client, endpoints.operationGet, { params: { id }, query: {}, body: undefined });
  return <section className="admin-policy" aria-label="Operation details">
    <div className="admin-row"><h2>Operation details</h2><Button onClick={operation.refresh}>Refresh status</Button></div>
    {operation.error ? <p role="alert">{operation.error}</p> : operation.loading ? <Spinner label="Loading operation" />
      : operation.resource && <OperationResult client={client} operation={operation.resource.data} />}
  </section>;
}

function OperationResult({ client, operation }: { readonly client: AdminClient; readonly operation: Operation }) {
  const blob = DigestSchema.safeParse(operation.result?.["blob"]);
  const artifact = IdSchema.safeParse(operation.result?.["artifactId"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    const id = blob.success ? operation.id : artifact.success ? artifact.data : null;
    if (!id) return;
    setBusy(true); setError("");
    try {
      const response = await client.callWithMetadata(blob.success ? endpoints.operationDownload : endpoints.artifactContent,
        { params: { id }, query: {}, body: undefined });
      if ("error" in response.result) setError(response.result.error.message);
      else {
        const name = response.metadata.headers["content-disposition"]?.match(/filename="([^"]+)"/)?.[1]
          ?? `${operation.kind.replace(/[^a-zA-Z0-9.-]/g, "-")}.${response.metadata.headers["content-type"] === "application/pdf" ? "pdf" : "zip"}`;
        downloadBytes(response.result.data, name.replace(/[\\/]/g, "-"));
      }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <>
    <dl className="admin-values"><div><dt>Task</dt><dd>{operation.kind}</dd></div>
      <div><dt>Status</dt><dd>{operation.status}</dd></div>
      <div><dt>Progress</dt><dd><progress max={1} value={operation.progress} aria-label="Operation progress" /> {Math.round(operation.progress * 100)}%</dd></div>
    </dl>
    {operation.errorCode && <p role="alert">{operation.errorCode}</p>}
    {operation.status === "succeeded" && (blob.success || artifact.success) && <Button busy={busy} onClick={() => void download()}>Download output</Button>}
    {operation.result && <details><summary>Result details</summary><DataView value={operation.result} /></details>}
    {error && <p role="alert">{error}</p>}
  </>;
}
