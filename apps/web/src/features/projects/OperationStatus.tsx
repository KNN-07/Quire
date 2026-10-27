import { useState } from "react";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Operation } from "@quire/contracts";
import { Button } from "../../ui";
import { errorMessage, value } from "./api";
import type { ProjectsPageProps } from "./api";

export function OperationStatus({ operation: initial, client, navigate, onComplete, downloadable = false }: {
  readonly operation: Operation;
  readonly client: ProjectsPageProps["client"];
  readonly navigate: ProjectsPageProps["navigate"];
  readonly onComplete?: () => void;
  readonly downloadable?: boolean;
}) {
  const [operation, setOperation] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const projectId = IdSchema.safeParse(operation.result?.["projectId"]);
  const finished = ["succeeded", "failed", "canceled", "timeout"].includes(operation.status);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const updated = value(await client.call(endpoints.operationGet, { params: { id: operation.id }, query: {}, body: undefined, headers: {} }));
      setOperation(updated);
      if (updated.status === "succeeded") onComplete?.();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true);
    try {
      const bytes = value(await client.call(endpoints.operationDownload, { params: { id: operation.id }, query: {}, body: undefined, headers: {} }));
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/zip" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "quire-projects.zip";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className="p-operation" aria-label="Operation status">
    <p role="status">{operation.kind}: {operation.status} ({Math.round(operation.progress * 100)}%)</p>
    {operation.errorCode && <p role="alert">{operation.errorCode}</p>}
    {error && <p role="alert">{error}</p>}
    {!finished && <Button busy={busy} onClick={() => void refresh()}>Check status</Button>}
    {operation.status === "succeeded" && projectId.success && <Button onClick={() => navigate(`/projects/${projectId.data}/edit`)}>Open imported project</Button>}
    {operation.status === "succeeded" && downloadable && <Button busy={busy} onClick={() => void download()}>Download source ZIP</Button>}
  </section>;
}
