import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { TemplateVersion } from "@quire/contracts";
import { Button, EmptyState, Modal, Spinner, StatusBadge } from "../../ui";
import type { AdminClient } from "./api";
import { errorMessage } from "./api";
import { useAdminResource } from "./useAdminResource";
import { TemplateForm } from "./TemplateForm";

const transitions = {
  draft: { label: "Submit", endpoint: endpoints.templateSubmit },
  submitted: { label: "Approve", endpoint: endpoints.templateApprove },
  approved: { label: "Publish", endpoint: endpoints.templatePublish },
  published: { label: "Unpublish", endpoint: endpoints.templateUnpublish },
  unpublished: null,
} as const;

export function Templates({ client }: { readonly client: AdminClient }) {
  const [cursor, setCursor] = useState<string | undefined>();
  const templates = useAdminResource(client, endpoints.adminTemplatesList, { params: {}, query: { limit: 50, cursor }, body: undefined });
  const [editing, setEditing] = useState<TemplateVersion | "new" | null>(null);
  const [selected, setSelected] = useState<TemplateVersion | null>(null);
  const [draftSource, setDraftSource] = useState<{ readonly template: TemplateVersion; readonly key: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function createDraft() {
    if (!draftSource) return;
    setBusy(true); setMessage("");
    try {
      const template = draftSource.template;
      const response = await client.call(endpoints.templateVersion, { params: { id: template.templateId }, query: {},
        body: { snapshotId: template.snapshotId, expectedVersion: template.version },
        headers: { "idempotency-key": draftSource.key } });
      if ("error" in response) setMessage(response.error.message);
      else { setDraftSource(null); setEditing(response.data); templates.refresh(); }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function advance() {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const action = transitions[selected.status];
      if (!action) return;
      const params = { id: selected.templateId };
      const body = { expectedVersion: selected.version };
      let response;
      switch (selected.status) {
        case "draft": response = await client.call(endpoints.templateSubmit, { params, query: {}, body }); break;
        case "submitted": response = await client.call(endpoints.templateApprove, { params, query: {}, body: { ...body, versionId: selected.id } }); break;
        case "approved": response = await client.call(endpoints.templatePublish, { params, query: {}, body: { ...body, versionId: selected.id } }); break;
        case "published": response = await client.call(endpoints.templateUnpublish, { params, query: {}, body }); break;
        case "unpublished": return;
        default: { const exhaustive: never = selected.status; throw new TypeError("Unknown template state", { cause: exhaustive }); }
      }
      if ("error" in response) setMessage(response.error.message);
      else { setMessage(`${response.data.name}: ${response.data.status}.`); setSelected(null); templates.refresh(); }
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="admin-templates-title">
    <div className="admin-row admin-page-heading"><h1 id="admin-templates-title">Templates</h1>
      <Button onClick={templates.refresh}>Refresh</Button><Button variant="primary" onClick={() => setEditing("new")}>Create template</Button></div>
    <p className="admin-muted">Review submitted source versions before publishing. Existing project copies remain independent.</p>
    {message && <p role="status" className="admin-message">{message}</p>}
    {templates.error ? <p role="alert">{templates.error}</p> : templates.loading ? <Spinner label="Loading templates" />
      : templates.resource?.data.items.length ? <div className="admin-user-table"><table className="admin-table">
        <thead><tr><th>Template</th><th>Visibility</th><th>License</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{templates.resource.data.items.map(template => <tr key={template.id}>
          <td data-label="Template"><strong>{template.name}</strong><small>{template.category}</small></td>
          <td data-label="Visibility">{template.visibility}</td><td data-label="License">{template.license}</td>
          <td data-label="Status"><StatusBadge state={template.status} /></td>
          <td data-label="Actions"><div className="admin-row">
            {template.status === "draft" && <Button size="small" onClick={() => setEditing(template)}>Edit</Button>}
            {template.status !== "draft" && <Button size="small" onClick={() => {
              setDraftSource({ template, key: crypto.randomUUID() }); setMessage("");
            }}>New draft</Button>}
            {transitions[template.status] && <Button size="small" onClick={() => { setSelected(template); setMessage(""); }}>{transitions[template.status]?.label}</Button>}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState icon="template" title="No templates yet" description="Create a template from one of your source projects." />}
    <div className="admin-row">{cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
      {templates.resource?.data.nextCursor && <Button onClick={() => setCursor(templates.resource?.data.nextCursor ?? undefined)}>Next page</Button>}</div>
    {editing && <TemplateForm client={client} template={editing === "new" ? null : editing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); templates.refresh(); }} />}
    <Modal open={draftSource !== null} title="Create a new template draft" onClose={() => { if (!busy) setDraftSource(null); }}
      footer={<><Button disabled={busy} onClick={() => setDraftSource(null)}>Cancel</Button>
        <Button busy={busy} variant="primary" onClick={() => void createDraft()}>Create draft</Button></>}>
      <p>Start an editable draft of {draftSource?.template.name} from this saved source snapshot. The current published version stays available.</p>
      <p>You can then change its metadata or choose a project to capture updated source. Only the template author can create a draft.</p>
      {message && <p role="alert">{message}</p>}
    </Modal>
    <Modal open={selected !== null} title={selected ? `${transitions[selected.status]?.label ?? "Review"} template` : "Template"}
      onClose={() => { if (!busy) setSelected(null); }}
      footer={<><Button disabled={busy} onClick={() => setSelected(null)}>Cancel</Button>
        <Button busy={busy} variant="primary" onClick={() => void advance()}>{selected ? transitions[selected.status]?.label : "Confirm"}</Button></>}>
      {selected && <><h2>{selected.name}</h2><p>{selected.description || "No description supplied."}</p>
        <dl className="admin-values"><div><dt>License</dt><dd>{selected.license}</dd></div>
          <div><dt>Visibility</dt><dd>{selected.visibility}</dd></div><div><dt>Status</dt><dd>{selected.status}</dd></div>
          <div><dt>Source snapshot</dt><dd><code>{selected.snapshotId}</code></dd></div></dl>
        <p>The server checks the selected version, your publication role and the current template state.</p></>}
      {message && <p role="alert">{message}</p>}
    </Modal>
  </section>;
}
