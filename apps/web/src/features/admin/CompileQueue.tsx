import { useState } from "react";
import { endpoints } from "@quire/contracts";
import { Button, RelativeTime, Spinner, StatusBadge } from "../../ui";
import type { AdminClient } from "./api";
import { useAdminResource } from "./useAdminResource";

export function CompileQueue({ client, navigate }: {
  readonly client: AdminClient; readonly navigate: (path: string) => void;
}) {
  const [cursor, setCursor] = useState<string>();
  const queue = useAdminResource(client, endpoints.adminCompileQueue, {
    params: {}, query: { limit: 25, ...(cursor ? { cursor } : {}) }, body: undefined,
  });
  return <section aria-label="Compile queue">
    <div className="admin-row admin-page-heading"><h2>Compile queue</h2>
      <Button onClick={() => { setCursor(undefined); queue.refresh(); }}>Refresh queue</Button>
      <Button onClick={() => navigate("/admin/workers")}>Add worker</Button></div>
    <p className="admin-muted">Persisted queued and running jobs, oldest first. Worker configuration opens separately;
      this list does not measure worker health. Refresh to see state changes.</p>
    {queue.loading ? <Spinner label="Loading compile queue" /> : queue.error ? <p role="alert">{queue.error}</p>
      : queue.resource && <><div className="admin-resource">
        {queue.resource.data.items.length === 0 ? <p>No queued or running jobs.</p> : <table className="admin-table">
          <thead><tr><th>Project</th><th>Compiler</th><th>Status</th><th>Worker</th><th>Queued</th></tr></thead>
          <tbody>{queue.resource.data.items.map(job => <tr key={job.id}>
            <td data-label="Project">{job.projectName}<small> · {job.branch}</small></td>
            <td data-label="Compiler">{job.engine}</td><td data-label="Status"><StatusBadge state={job.status} /></td>
            <td data-label="Worker">{job.workerId ?? "Not assigned"}</td>
            <td data-label="Queued"><RelativeTime value={job.queuedAt} /></td>
          </tr>)}</tbody></table>}
      </div>
      {queue.resource.data.nextCursor && <Button onClick={() => setCursor(queue.resource?.data.nextCursor ?? undefined)}>Next queued jobs</Button>}
      {cursor && <Button onClick={() => setCursor(undefined)}>First queued jobs</Button>}
    </>}
  </section>;
}
