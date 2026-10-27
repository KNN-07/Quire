import { useState } from "react";
import { endpoints } from "@quire/contracts";
import type { Id, ProjectSummary } from "@quire/contracts";
import { Button, Field, Spinner } from "../../ui";
import type { AdminClient } from "./api";
import { useAdminResource } from "./useAdminResource";

export function EnvironmentFonts({ client, value, onChange }: {
  readonly client: AdminClient; readonly value: readonly Id[];
  readonly onChange: (ids: readonly Id[]) => void;
}) {
  const [q, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const projects = useAdminResource(client, endpoints.projectList, {
    params: {}, query: { q, cursor, limit: 50, owner: "all", state: "active", sort: "title", direction: "asc" }, body: undefined,
  });
  return <fieldset><legend>Custom fonts (optional)</legend>
    <p>Choose font files already uploaded to a project you can read. The build service checks access and file content.</p>
    <Field label="Find font project" value={q} onChange={event => { setQuery(event.currentTarget.value); setCursor(undefined); }} />
    {projects.error ? <p role="alert">{projects.error}</p> : projects.loading ? <Spinner label="Loading font projects" /> : <>
      <label className="admin-label">Font project<select value={project?.id ?? ""}
        onChange={event => { setProject(projects.resource?.data.items.find(item => item.id === event.currentTarget.value) ?? null); onChange([]); }}>
        <option value="">No custom fonts</option>
        {project && !projects.resource?.data.items.some(item => item.id === project.id) && <option value={project.id}>{project.name}</option>}
        {projects.resource?.data.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className="admin-row">{cursor && <Button type="button" onClick={() => setCursor(undefined)}>First projects</Button>}
        {projects.resource?.data.nextCursor && <Button type="button" onClick={() => setCursor(projects.resource?.data.nextCursor ?? undefined)}>More projects</Button>}</div>
    </>}
    {project && <FontFiles key={project.id} client={client} project={project} value={value} onChange={onChange} />}
  </fieldset>;
}

function FontFiles({ client, project, value, onChange }: {
  readonly client: AdminClient; readonly project: ProjectSummary; readonly value: readonly Id[];
  readonly onChange: (ids: readonly Id[]) => void;
}) {
  const files = useAdminResource(client, endpoints.filesList, {
    params: { p: project.id }, query: { branch: project.defaultBranch }, body: undefined,
  });
  const fonts = files.resource?.data.filter(file => file.kind === "file" && /\.(otf|ttf|ttc)$/i.test(file.path)) ?? [];
  return files.error ? <p role="alert">{files.error}</p> : files.loading ? <Spinner label="Loading project fonts" />
    : fonts.length === 0 ? <p>No OpenType or TrueType font files in this project.</p>
      : <div>{fonts.map(font => <label className="admin-check" key={font.id}>
        <input type="checkbox" checked={value.includes(font.id)} onChange={event =>
          onChange(event.currentTarget.checked ? [...value, font.id] : value.filter(id => id !== font.id))} />
        {font.path}
      </label>)}</div>;
}
