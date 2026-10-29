import type { endpoints, ResponseOf } from "@quire/contracts";
import { Button, formatBytes, StatusBadge } from "../../ui";

export function Overview({ data, refresh, navigate }: {
  readonly data: ResponseOf<typeof endpoints.adminOverview>;
  readonly refresh: () => void;
  readonly navigate: (path: string) => void;
}) {
  const counts = [
    { label: "Users", value: data.users.toLocaleString(), detail: "Registered accounts", path: "/admin/users" },
    { label: "Projects", value: data.projects.toLocaleString(), detail: "Stored projects", path: "/projects" },
    { label: "Storage", value: formatBytes(data.storageBytes), detail: "Stored content", path: "/admin/storage" },
    { label: "Compile queue", value: data.queuedJobs.toLocaleString(), detail: `${data.runningJobs.toLocaleString()} running`, path: "/admin/workers" },
  ];
  return <>
    <div className="admin-row admin-page-heading"><div><h1>Server overview</h1>
      <p className="admin-muted">Account, storage and compilation activity reported by this instance.</p></div><Button onClick={refresh}>Refresh overview</Button></div>
    <div className="admin-overview-cards">
      {counts.map(item => <section className="admin-overview-card" key={item.label}>
        <h2>{item.label}</h2><strong>{item.value}</strong><p>{item.detail}</p>
        <Button size="small" variant="ghost" onClick={() => navigate(item.path)}>View {item.label.toLowerCase()} →</Button>
      </section>)}
    </div>
    <section aria-labelledby="admin-service-heading">
      <h2 id="admin-service-heading">Services</h2>
      {data.topology.length === 0 ? <p className="admin-muted">No service status has been reported.</p> : <ul className="admin-health">
        {data.topology.map((service, index) => <li key={`${service.role}-${index}`}>
          <strong>{service.role}</strong>
          <span>{service.backend} · <StatusBadge state={service.state} /></span>
        </li>)}
      </ul>}
    </section>
    <section aria-labelledby="admin-capability-heading">
      <h2 id="admin-capability-heading">Configured capabilities</h2>
      <div className="admin-resource">
        {Object.keys(data.capabilities).length === 0 ? <p>No capabilities have been reported.</p> : <table className="admin-table">
          <thead><tr><th>Capability</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>{Object.entries(data.capabilities).map(([name, capability]) => <tr key={name}>
            <td data-label="Capability">{name}</td>
            <td data-label="Status"><StatusBadge state={capability.state} tone={capability.enabled ? undefined : "neutral"}>{capability.enabled || capability.state === "disabled" ? "" : " · disabled"}</StatusBadge></td>
            <td data-label="Details" className={capability.reason ? undefined : "admin-muted"}>{capability.reason || "None reported"}</td>
          </tr>)}</tbody>
        </table>}
      </div>
    </section>
  </>;
}
