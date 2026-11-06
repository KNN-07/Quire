import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ProjectSummary, ResponseOf } from "@quire/contracts";
import { billingUsageEndpoints } from "../../../../../packages/contracts/src/routes-billing-usage";
import type { SettingsProps } from "./settings";
import { Button } from "../../ui";
import { listInput, Notice, unwrap } from "./shared";

export function BillingUsage({ client }: Pick<SettingsProps, "client">) {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [usage, setUsage] = useState<ResponseOf<typeof billingUsageEndpoints.billingUsageGet> | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void client.call(endpoints.projectList, listInput, controller.signal).then(result => setProjects(unwrap(result).items))
      .catch((cause: unknown) => { if (!controller.signal.aborted && cause instanceof Error) setError(cause.message); });
    return () => controller.abort();
  }, [client]);
  useEffect(() => {
    const controller = new AbortController();
    setUsage(null); setError("");
    void client.call(billingUsageEndpoints.billingUsageGet, { params: {}, query: projectId ? { projectId } : {}, body: undefined }, controller.signal)
      .then(result => setUsage(unwrap(result)))
      .catch((cause: unknown) => { if (!controller.signal.aborted && cause instanceof Error) setError(cause.message); });
    return () => controller.abort();
  }, [client, projectId, refresh]);
  useEffect(() => {
    if (!usage) return undefined;
    const timer = window.setTimeout(() => setRefresh(value => value + 1), Math.max(1, Date.parse(usage.resetsAt) - Date.parse(usage.observedAt)));
    return () => window.clearTimeout(timer);
  }, [usage]);
  const project = usage?.project;
  return <section className="account-stack" aria-labelledby="billing-usage-title">
    <h3 id="billing-usage-title">Usage</h3>
    <p>Your AI receipts are shared across projects for your account. They are separate from the selected organization’s subscription. Purchases do not reset daily usage.</p>
    <label className="q-field"><span className="q-field__label">Project for applicable limits</span>
      <select className="q-input" value={projectId} onChange={event => setProjectId(event.target.value)}>
        <option value="">Choose a project</option>
        {projects.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select>
    </label>
    <Button onClick={() => setRefresh(value => value + 1)}>Refresh usage</Button>
    {error ? <Notice error={error} message="" /> : !usage ? <p role="status">Loading usage…</p> : <>
      <p>AI uses today ({usage.day} UTC): <strong>{usage.used + usage.reserved}{project?.aiDailyLimit !== null && project?.aiDailyLimit !== undefined ? ` of ${project.aiDailyLimit}` : ""}</strong></p>
      <p>{usage.used} dispatched · {usage.reserved} reserved · {usage.refunded} refunded (not counted). Resets at {usage.resetsAt} (00:00 UTC).</p>
      {!project ? <p>Applicable AI allowance and project limits are unknown until you choose an authorized project.</p> : <>
        <p>Limits for {project.name}. Project owner: {project.ownerId}.</p>
        {project.aiUnavailable && <p>AI unavailable in this project: {project.aiUnavailable} Daily allowance unavailable.</p>}
        <p>Writable collaborators: {project.effectiveMembers} effective, {project.assignedMembers} assigned; owner benefit limit: {project.writableMembers === null ? "Unlimited" : project.writableMembers}. The owner is excluded; viewers do not consume writable capacity.</p>
        {project.selectionRequired && <p>The project owner must select writable collaborators before assigned members can write.</p>}
        <p>Compile policy allowance for you in this project: {project.compileSeconds} seconds per job. Worker and execution caps can lower the actual timeout. This is not a daily compile budget.</p>
      </>}
    </>}
  </section>;
}
