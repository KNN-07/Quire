import { useCallback, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Id, TemplateVersion } from "@quire/contracts";
import { Button, Spinner } from "../../ui";
import { errorMessage, useResource, value } from "./api";
import type { ProjectsPageProps } from "./api";
import { NewProjectDialog } from "./NewProjectDialog";

export function InstitutionTemplates({ client, organizationId, navigate }: {
  readonly client: ProjectsPageProps["client"]; readonly organizationId: Id;
  readonly navigate: ProjectsPageProps["navigate"];
}) {
  const [chosen, setChosen] = useState<TemplateVersion | null>(null);
  const [candidate, setCandidate] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const access = useResource(useCallback(async (signal: AbortSignal) => {
    const response = await client.call(endpoints.organizationAccess, {
      params: { o: organizationId }, query: {}, body: undefined,
    }, signal);
    return "data" in response && (response.data.operator || response.data.role === "admin");
  }, [client, organizationId]));
  const canManage = access.data === true;
  const featured = useResource(useCallback(async (signal: AbortSignal) => {
    const rows: TemplateVersion[] = [];
    let cursor: string | undefined;
    do {
      const page = value(await client.call(endpoints.institutionTemplates, {
        params: { o: organizationId }, query: { limit: 100, cursor }, body: undefined,
      }, signal));
      rows.push(...page.items); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return rows;
  }, [client, organizationId]));
  const candidates = useResource(useCallback(async (signal: AbortSignal) => {
    if (!canManage) return [];
    const rows: TemplateVersion[] = [];
    let cursor: string | undefined;
    do {
      const page = value(await client.call(endpoints.templatesList, {
        params: {}, query: { limit: 100, cursor }, body: undefined,
      }, signal));
      rows.push(...page.items.filter(item => item.status === "published"
        && (item.visibility === "public" || (item.visibility === "organization" && item.organizationId === organizationId))));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return rows;
  }, [client, canManage, organizationId]));
  async function select() {
    const template = candidates.data?.find(item => item.id === candidate);
    if (!template) return;
    setBusy(true); setMessage("");
    try {
      value(await client.call(endpoints.institutionTemplateSelect, {
        params: { o: organizationId, id: template.templateId }, query: {},
        body: { versionId: template.id, expectedVersion: template.version },
      }));
      featured.reload(); candidates.reload(); setMessage("Featured template selected.");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function remove(template: TemplateVersion) {
    setBusy(true); setMessage("");
    try {
      value(await client.call(endpoints.institutionTemplateRemove, {
        params: { o: organizationId, id: template.templateId }, query: {},
        body: { expectedVersion: template.version },
      }));
      featured.reload(); candidates.reload(); setMessage("Template removed from featured selection.");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <article className="qm-card" aria-label="Featured templates">
    <h2>Featured templates</h2>
    <p>Selected by this institution from published, approved source versions. Copies remain independent.</p>
    {featured.loading ? <Spinner label="Loading featured templates" /> : featured.error
      ? <p role="alert">{featured.error}</p> : !featured.data?.length ? <p>No featured templates are currently available.</p>
        : featured.data.map(template => <div key={template.id}>
          <h3>{template.name}</h3><p>{template.description}</p><p>{template.license} · {template.visibility}</p>
          <Button onClick={() => setChosen(template)}>Use template {template.name}</Button>
          {canManage && <Button disabled={busy} onClick={() => void remove(template)}>Remove featured {template.name}</Button>}
        </div>)}
    {canManage && <section aria-label="Manage featured templates">
      <h3>Manage featured templates</h3>
      <p>Select a published version explicitly. Later source edits and publications do not update this selection.</p>
      {candidates.error && <p role="alert">{candidates.error}</p>}
      <label>Published template <select aria-label="Published template" value={candidate} onChange={event => setCandidate(event.currentTarget.value)}>
        <option value="">Choose a published template</option>
        {candidates.data?.map(item => <option key={item.id} value={item.id}>{item.name} · {item.license}</option>)}
      </select></label>
      <Button disabled={!candidate || busy} busy={busy} onClick={() => void select()}>Feature selected version</Button>
      <Button disabled={busy} onClick={() => { candidates.reload(); featured.reload(); }}>Refresh templates</Button>
    </section>}
    {message && <p role="status">{message}</p>}
    {chosen && <NewProjectDialog client={client} navigate={navigate} open initialTemplate={chosen}
      initialMode="template" onClose={() => setChosen(null)}
      onCreated={project => { setChosen(null); navigate(`/projects/${project.id}/edit`); }} />}
  </article>;
}
