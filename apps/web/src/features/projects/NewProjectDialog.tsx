import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import { assertNever, endpoints, EngineSchema, IdSchema } from "@quire/contracts";
import type { Operation, Project, TemplateVersion } from "@quire/contracts";
import { Button, Field, Modal, Tabs } from "../../ui";
import { errorMessage, mutationHeaders, useResource, value } from "./api";
import type { ProjectsPageProps } from "./api";
import { TemplateBrowser } from "./Templates";
import { OperationStatus } from "./OperationStatus";
import "./projects.css";

const ModeSchema = z.enum(["blank", "template", "github", "upload", "git"]);
export type NewProjectMode = z.infer<typeof ModeSchema>;
const modes = [
  { value: "blank", label: "Blank" }, { value: "template", label: "From template" },
  { value: "github", label: "Import from GitHub" }, { value: "upload", label: "Upload .zip" },
  { value: "git", label: "Clone git URL" },
] as const;
const labels = { blank: "Create project", template: "Create from template", github: "Import repository", upload: "Upload and create", git: "Clone and create" } as const;
export type NewProjectDialogProps = {
  readonly client: ProjectsPageProps["client"];
  readonly navigate: ProjectsPageProps["navigate"];
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (project: Project) => void;
  readonly initialMode?: NewProjectMode;
  readonly initialTemplate?: TemplateVersion;
};

export function NewProjectDialog(props: NewProjectDialogProps) {
  // Mount a fresh form per opening; closing discards unsubmitted fields.
  return props.open ? <CreationForm {...props} /> : null;
}
function CreationForm({ client, navigate, onClose, onCreated, initialMode = "template", initialTemplate }: NewProjectDialogProps) {
  const [mode, setMode] = useState<NewProjectMode>(initialMode);
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [template, setTemplate] = useState(initialTemplate);
  const [example, setExample] = useState(true);
  const [engine, setEngine] = useState<Project["settings"]["engine"]>("pdflatex");
  const [environment, setEnvironment] = useState("");
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [grant, setGrant] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<Operation>();
  const [created, setCreated] = useState<Project>();
  const attempt = useRef<{
    readonly fingerprint: string;
    readonly file: File | undefined;
    readonly headers: ReturnType<typeof mutationHeaders>;
  } | undefined>(undefined);
  const organizations = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.organizationsList, {
    params: {}, query: { limit: 100 }, body: undefined, headers: {},
  }, signal)).items, [client]));
  const environments = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.environmentsList, {
    params: {}, query: {}, body: undefined, headers: {},
  }, signal)), [client]));
  const grants = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.connectionsList, {
    params: {}, query: { limit: 100 }, body: undefined, headers: {},
  }, signal)).items, [client]));
  const available = (environments.data ?? []).filter(item => item.available && item.engines.includes(engine));
  const environmentId = environment || available[0]?.id;
  const grantsForMode = (grants.data ?? []).filter(item => item.provider === (mode === "github" ? "github" : "git"));
  const readyGrants = grantsForMode.filter(item => item.state === "ready");
  const projectName = name.trim() || (template && mode === "template" ? `Untitled ${template.name}` : "Untitled project");
  async function create() {
    setBusy(true);
    setError("");
    try {
      const workspaceFields = workspace ? { workspaceId: IdSchema.parse(workspace) } : {};
      const fingerprint = JSON.stringify({ mode, projectName, workspace, example, template: template?.id, url, branch, grant });
      const previous = attempt.current;
      const headers = previous && previous.fingerprint === fingerprint && previous.file === file ? previous.headers : mutationHeaders();
      attempt.current = { fingerprint, file, headers };
      switch (mode) {
        case "blank":
        case "template": {
          if (mode === "template" && !template) { setError("Select a template."); return; }
          let project = created;
          if (project) project = value(await client.call(endpoints.projectGet, {
            params: { p: project.id }, query: { branch: project.defaultBranch }, body: undefined, headers: {},
          }));
          if (!project) {
            const origin = mode === "template" && template ? { kind: "template" as const, templateVersionId: template.id } :
              { kind: example ? "example" as const : "blank" as const };
            project = value(await client.call(endpoints.projectCreate, {
              params: {}, query: {}, body: { name: projectName, ...workspaceFields, origin }, headers,
            }));
            setCreated(project);
          }
          if (mode === "blank") {
            project = value(await client.call(endpoints.projectPatch, {
              params: { p: project.id }, query: {}, body: { expectedVersion: project.version,
                settings: { ...project.settings, engine, environmentId: environmentId ? IdSchema.parse(environmentId) : project.settings.environmentId } }, headers: {},
            }));
          }
          onCreated(project);
          return;
        }
        case "upload": {
          if (!file) { setError("Choose a ZIP file."); return; }
          const form = new FormData();
          form.set("kind", "zip");
          form.set("name", projectName);
          form.set("source", file);
          if (workspace) form.set("workspaceId", workspace);
          setOperation(value(await client.call(endpoints.importCreate, { params: {}, query: {}, body: form, headers })));
          return;
        }
        case "github":
        case "git": {
          setOperation(value(await client.call(endpoints.importCreate, {
            params: {}, query: {}, headers, body: {
              kind: mode, name: projectName, ...workspaceFields,
              source: { kind: "git", url, branch, ...(grant ? { grantId: IdSchema.parse(grant) } : {}) },
            },
          })));
          return;
        }
        default: assertNever(mode);
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  const blank = <div className="p-form-grid">
    <label className="p-field">Compiler<select aria-label="Compiler" value={engine} onChange={event => { setEngine(EngineSchema.parse(event.target.value)); setEnvironment(""); }}>
      <option value="pdflatex">pdfLaTeX</option><option value="latex">LaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option>
    </select></label>
    <label className="p-field">TeX Live version<select aria-label="TeX Live version" value={environmentId ?? ""} onChange={event => setEnvironment(event.target.value)}>
      {available.length === 0 && <option value="">Server default (not verified)</option>}
      {available.map(item => <option key={item.id} value={item.id}>{item.label}{item.experimental ? " (experimental)" : ""}</option>)}
    </select></label>
    {environments.error && <p role="alert">{environments.error} <Button onClick={environments.reload}>Retry environments</Button></p>}
    <label className="p-check p-full"><input type="checkbox" disabled={Boolean(created)} checked={example} onChange={event => setExample(event.target.checked)} />Start with an example main.tex and refs.bib</label>
    <p className="p-full">You can change the compiler later in project settings.</p>
  </div>;
  const gitFields = <div className="p-stack">
    <Field label="Repository URL" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://gitlab.example.edu/group/paper.git" />
    <div className="p-form-grid"><Field label="Branch" required value={branch} onChange={event => setBranch(event.target.value)} />
      <label className="p-field">Access token (private repos)<select aria-label="Access token (private repos)" value={grant} onChange={event => setGrant(event.target.value)}>
        <option value="">No credential (public repository)</option>
        {readyGrants.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select><small>Choose a saved connection. Tokens are managed in Settings.</small></label></div>
    {grants.loading && <p role="status">Loading connections…</p>}
    {grants.error && <p role="alert">{grants.error} <Button onClick={grants.reload}>Retry connections</Button></p>}
    {mode === "github" && grants.data && !grants.loading && !grants.error && readyGrants.length === 0 && <p role="status">GitHub is not connected. Requires GitHub connected in Settings.</p>}
    {grantsForMode.filter(item => item.state !== "ready").map(item => <p key={item.id}>{item.label}: {item.state}</p>)}
    <Button onClick={() => navigate("/settings/connections")}>Connection settings</Button>
    <p>The full history comes with it, so it shows up in History and Git.</p>
    {mode === "github" && <label className="p-check"><input type="checkbox" disabled />Keep in sync with GitHub (two-way)<small>Configure sync after import in connection settings.</small></label>}
  </div>;
  const upload = <div className="p-upload" onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault(); setFile(event.dataTransfer.files[0]);
  }}><strong>Drop a .zip project here</strong><p>Folders and file names are kept as they are. Server upload limits apply.</p>
    <Field label="Choose file" type="file" accept=".zip,application/zip" onChange={event => setFile(event.target.files?.[0])} />
    {file && <p>{file.name} · {file.size.toLocaleString()} bytes</p>}
  </div>;
  const content = { blank, template: <TemplateBrowser client={client} compact {...(template ? { selection: template.id } : {})} onChoose={setTemplate} />, github: gitFields, upload, git: gitFields };
  return <Modal open onClose={() => { if (!busy) onClose(); }} title="New project" size="wide"
    footer={<div className="p-dialog-footer"><span>{template && mode === "template" ? `Selected: ${template.name}` : "Projects are private by default."}</span><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={Boolean(operation)} type="submit" form="new-project-form">{created ? "Retry project settings" : labels[mode]}</Button></div>}>
    <form id="new-project-form" className="p-stack" onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className="p-form-grid"><Field label="Project name" value={name} placeholder={projectName} disabled={Boolean(created)} onChange={event => setName(event.target.value)} />
        <label className="p-field">Workspace<select aria-label="Workspace" disabled={Boolean(created)} value={workspace} onChange={event => setWorkspace(event.target.value)}><option value="">Personal</option>{organizations.data?.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
          {organizations.error && <span role="alert">{organizations.error}</span>}</label></div>
      <Tabs label="How to start" value={mode} onValueChange={next => { setMode(ModeSchema.parse(next)); setGrant(""); setFile(undefined); setError(""); }} items={modes.map(item => ({ ...item, disabled: busy || Boolean(created) || Boolean(operation), content: item.value === mode ? content[item.value] : null }))} />
      {error && <p role="alert">{error}</p>}
      {created && error && <Button onClick={() => { onCreated(created); }}>Open created project with default settings</Button>}
      {operation && <OperationStatus key={operation.id} operation={operation} client={client} navigate={navigate} />}
    </form>
  </Modal>;
}
