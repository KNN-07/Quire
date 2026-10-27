import { useState } from "react";
import { endpoints, TemplateVersionSchema } from "@quire/contracts";
import type { TemplateVersion } from "@quire/contracts";
import { Button, Field, Modal, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";

export function TemplateForm({ client, template, onClose, onSaved }: {
  readonly client: AdminClient; readonly template: TemplateVersion | null;
  readonly onClose: () => void; readonly onSaved: () => void;
}) {
  const [q, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const projects = useAdminResource(client, endpoints.projectList, {
    params: {}, query: { q, cursor, limit: 50, owner: "all", state: "active", sort: "title", direction: "asc" }, body: undefined,
  });
  const [source, setSource] = useState("");
  const [name, setName] = useState(template?.name ?? "");
  const [category, setCategory] = useState(template?.category ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [license, setLicense] = useState(template?.license ?? "");
  const [visibility, setVisibility] = useState<TemplateVersion["visibility"]>(template?.visibility ?? "private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  async function save() {
    const project = projects.resource?.data.items.find(item => item.id === source);
    if (!template && !project) return;
    setBusy(true); setError("");
    try {
      const fields = { name, category, description, license, visibility };
      const response = template
        ? await client.call(endpoints.templatePatch, { params: { id: template.templateId }, query: {},
          body: { ...fields, expectedVersion: template.version, ...(project ? { sourceProjectId: project.id } : {}) } })
        : project ? await client.call(endpoints.templateCreate, { params: {}, query: {},
          body: { ...fields, sourceProjectId: project.id }, headers: { "idempotency-key": key } }) : null;
      if (response && "error" in response) setError(response.error.message);
      else if (response) onSaved();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <Modal open className="admin-template-dialog" title={template ? "Edit template draft" : "Create template"} onClose={() => { if (!busy) onClose(); }}
    footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" form="admin-template-form" busy={busy} variant="primary">Save template</Button></>}>
    <form id="admin-template-form" className="admin-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field label="Name" required value={name} onChange={event => setName(event.currentTarget.value)} />
      <Field label="Category" value={category} onChange={event => setCategory(event.currentTarget.value)} />
      <label className="admin-label">Description<textarea value={description} onChange={event => setDescription(event.currentTarget.value)} /></label>
      <Field label="License" required value={license} onChange={event => setLicense(event.currentTarget.value)} />
      <label className="admin-label">Visibility<select value={visibility} onChange={event =>
        setVisibility(TemplateVersionSchema.unwrap().shape.visibility.parse(event.currentTarget.value))}>
        <option value="private">Private</option><option value="organization">Organization</option><option value="public">Public</option>
      </select></label>
      <Field label="Find source project" value={q} onChange={event => { setQuery(event.currentTarget.value); setCursor(undefined); setSource(""); }} />
      {projects.error ? <p role="alert">{projects.error}</p> : projects.loading ? <Spinner label="Loading source projects" /> : <>
        <label className="admin-label">Source project<select required={!template} value={source} onChange={event => setSource(event.currentTarget.value)}>
          <option value="">{template ? "Keep existing source snapshot" : "Choose a project"}</option>
          {projects.resource?.data.items.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <div className="admin-row">{cursor && <Button type="button" onClick={() => { setCursor(undefined); setSource(""); }}>First projects</Button>}
          {projects.resource?.data.nextCursor && <Button type="button" onClick={() => { setCursor(projects.resource?.data.nextCursor ?? undefined); setSource(""); }}>More projects</Button>}</div>
      </>}
      {error && <p role="alert">{error}</p>}
    </form>
  </Modal>;
}
