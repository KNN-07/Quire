import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { assertNever, endpoints, IdSchema } from "@quire/contracts";
import type { Operation, Project, TemplateVersion } from "@quire/contracts";
import { Button, Field, Modal, Tabs, formatBytes } from "../../ui";
import { errorMessage, mutationHeaders, useResource, value } from "./api";
import type { ProjectsPageProps } from "./api";
import { TemplateBrowser } from "./Templates";
import { OperationStatus } from "./OperationStatus";
import { CreationSettings } from "./CreationSettings";
import type { OnboardingImportContinuation } from "../account/onboarding-import";
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
  readonly onboardingImport?: OnboardingImportContinuation;
};

export function NewProjectDialog(props: NewProjectDialogProps) {
  // Normal dialogs discard unsubmitted fields; onboarding supplies its saved draft.
  return props.open ? <CreationForm {...props} /> : null;
}
function CreationForm({ client, navigate, onClose, onCreated, initialMode = "template", initialTemplate, onboardingImport }: NewProjectDialogProps) {
  const [mode, setMode] = useState<NewProjectMode>(onboardingImport?.draft.mode ?? initialMode);
  const [name, setName] = useState(onboardingImport?.draft.name ?? "");
  const [workspace, setWorkspace] = useState<string>(onboardingImport?.draft.workspaceId ?? "");
  const [template, setTemplate] = useState(initialTemplate);
  const [example, setExample] = useState(true);
  const [engineChoice, setEngine] = useState<Project["settings"]["engine"] | undefined>(onboardingImport?.draft.engine);
  const [environment, setEnvironment] = useState<string>(onboardingImport?.draft.environmentId ?? "");
  const [mainPath, setMainPath] = useState(onboardingImport?.draft.mainPath ?? "");
  const [preserveHistory, setPreserveHistory] = useState(onboardingImport?.draft.preserveHistory ?? true);
  const [keepConnected, setKeepConnected] = useState(onboardingImport?.draft.keepConnected ?? true);
  const [url, setUrl] = useState(onboardingImport?.draft.url ?? "");
  const [branch, setBranch] = useState(onboardingImport?.draft.branch ?? "main");
  const [grant, setGrant] = useState<string>(onboardingImport?.draft.grantId ?? "");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<Operation | undefined>(onboardingImport?.operation ?? undefined);
  const [created, setCreated] = useState<Project>();
  const saveImportDraft = onboardingImport?.saveDraft;
  const importLocked = Boolean(onboardingImport?.locked);
  const choicesLocked = busy || Boolean(created) || Boolean(operation) || importLocked;
  useEffect(() => {
    if (onboardingImport) setOperation(onboardingImport.operation ?? undefined);
  }, [onboardingImport?.operation]);
  const attempt = useRef<{
    readonly fingerprint: string;
    readonly file: File | undefined;
    readonly headers: ReturnType<typeof mutationHeaders>;
  } | undefined>(undefined);
  const organizations = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.organizationsList, {
    params: {}, query: { limit: 100 }, body: undefined, headers: {},
  }, signal)).items, [client]));
  const environments = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.environmentsAdmission, {
    params: {}, query: {}, body: undefined, headers: {},
  }, signal)), [client]));
  const preferences = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.preferencesGet, {
    params: {}, query: {}, body: undefined, headers: {},
  }, signal)), [client]));
  const grants = useResource(useCallback(async (signal: AbortSignal) => value(await client.call(endpoints.connectionsList, {
    params: {}, query: { limit: 100 }, body: undefined, headers: {},
  }, signal)).items, [client]));
  const engine = engineChoice ?? (mode === "blank" ? preferences.data?.defaultEngine : "pdflatex");
  const compatible = (environments.data ?? []).filter(item => engine && (mode !== "blank" || engine !== "plain") && item.environment.engines.includes(engine));
  const available = compatible.filter(item => item.selectable);
  const environmentId = environment || available.find(item => item.isDefault)?.environment.id || available[0]?.environment.id;
  const selectedEnvironment = available.find(item => item.environment.id === environmentId);
  const grantsForMode = (grants.data ?? []).filter(item => item.provider === (mode === "github" ? "github" : "git"));
  const readyGrants = grantsForMode.filter(item => item.state === "ready");
  const remote = mode === "github" || mode === "git";
  useEffect(() => {
    if (!saveImportDraft || importLocked || mode === "blank" || mode === "template" || !engine || !environmentId) return;
    void saveImportDraft({ mode, name, workspaceId: workspace ? IdSchema.parse(workspace) : null,
      url, branch, grantId: grant ? IdSchema.parse(grant) : null,
      ...(mainPath.trim() ? { mainPath: mainPath.trim() } : {}), engine, environmentId: IdSchema.parse(environmentId),
      ...(remote ? { preserveHistory, keepConnected } : {}),
    }).catch(cause => setError(errorMessage(cause)));
  }, [saveImportDraft, importLocked, mode, name, workspace, url, branch, grant, mainPath, engine, environmentId, remote, preserveHistory, keepConnected]);
  const projectName = name.trim() || (template && mode === "template" ? `Untitled ${template.name}` : "Untitled project");
  async function create() {
    setBusy(true);
    setError("");
    try {
      if (!importLocked && !selectedEnvironment) {
        setError("Choose an environment with passed toolchain probes and execution admission.");
        return;
      }
      if (onboardingImport?.locked && !onboardingImport.requiredFile) {
        setOperation(await onboardingImport.submit());
        return;
      }
      const workspaceFields = workspace ? { workspaceId: IdSchema.parse(workspace) } : {};
      if (remote && !importLocked && !readyGrants.some(item => item.id === grant)) {
        setError("Choose a ready saved connection before importing this repository."); return;
      }
      const selection = {
        ...(mode !== "blank" && mainPath.trim() ? { mainPath: mainPath.trim() } : {}),
        ...(engine ? { engine } : {}), ...(environmentId ? { environmentId: IdSchema.parse(environmentId) } : {}),
      };
      const fingerprint = JSON.stringify({ mode, projectName, workspace, example, ...selection, template: template?.id,
        url, branch, grant, preserveHistory, keepConnected });
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
              params: {}, query: {}, body: { name: projectName, ...workspaceFields, origin,
                ...selection }, headers,
            }));
            setCreated(project);
          }
          const readiness = value(await client.call(endpoints.environmentsAdmission, {
            params: {}, query: {}, body: undefined, headers: {},
          }));
          if (!readiness.some(item => item.environment.id === project.settings.environmentId && item.selectable)) {
            setError("The project exists, but its environment is not executable. Open it to choose an admitted environment in project settings.");
            return;
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
          if (selection.mainPath) form.set("mainPath", selection.mainPath);
          if (selection.engine) form.set("engine", selection.engine);
          if (selection.environmentId) form.set("environmentId", selection.environmentId);
          setOperation(onboardingImport ? await onboardingImport.submit(form)
            : value(await client.call(endpoints.importCreate, { params: {}, query: {}, body: form, headers })));
          return;
        }
        case "github":
        case "git": {
          if (onboardingImport) {
            setOperation(await onboardingImport.submit({ kind: mode, name: projectName, ...workspaceFields,
              source: { kind: "git", url, branch, ...(grant ? { grantId: IdSchema.parse(grant) } : {}) },
              ...selection, preserveHistory, keepConnected,
            }));
            return;
          }
          setOperation(value(await client.call(endpoints.importCreate, {
            params: {}, query: {}, headers, body: {
              kind: mode, name: projectName, ...workspaceFields,
              source: { kind: "git", url, branch, ...(grant ? { grantId: IdSchema.parse(grant) } : {}) },
              ...selection, preserveHistory, keepConnected,
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
    <label className="p-check p-full"><input type="checkbox" disabled={choicesLocked} checked={example} onChange={event => setExample(event.target.checked)} />Start with an example document and introduction</label>
    <p className="p-full">You can change the compiler later in project settings.</p>
  </div>;
  const gitFields = <div className="p-stack">
    <Field label="Repository URL" type="url" required disabled={choicesLocked} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://gitlab.example.edu/group/paper.git" />
    <div className="p-form-grid"><Field label="Branch" required disabled={choicesLocked} value={branch} onChange={event => setBranch(event.target.value)} />
      <label className="p-field">Saved connection<select aria-label="Saved connection" required disabled={choicesLocked} value={grant} onChange={event => setGrant(event.target.value)}>
        <option value="">Choose a ready connection</option>
        {readyGrants.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select><small>This installation requires a saved connection, including for public repositories. Manage credentials in Settings.</small></label></div>
    {grants.loading && <p role="status">Loading connections…</p>}
    {grants.error && <p role="alert">{grants.error} <Button onClick={grants.reload}>Retry connections</Button></p>}
    {mode === "github" && grants.data && !grants.loading && !grants.error && readyGrants.length === 0 && <p role="status">GitHub is not connected. Requires GitHub connected in Settings.</p>}
    {grantsForMode.filter(item => item.state !== "ready").map(item => <p key={item.id}>{item.label}: {item.state}</p>)}
    <Button onClick={() => navigate("/settings/connections")}>Connection settings</Button>
    <label className="p-check"><input type="checkbox" disabled={choicesLocked} checked={preserveHistory}
      onChange={event => { setPreserveHistory(event.target.checked); if (!event.target.checked) setKeepConnected(false); }} />
      Import full Git history</label>
    <p>{preserveHistory ? "Retain the repository's branches, tags and commit history."
      : "Create an independent project with one source snapshot, without remote history. The repository is still fetched for inspection."}</p>
    <label className="p-check"><input type="checkbox" disabled={choicesLocked || !preserveHistory} checked={keepConnected}
      onChange={event => setKeepConnected(event.target.checked)} />Keep remote connection for pull and push</label>
    <p>Pull and push remain explicit actions, not automatic background synchronization.
      An independent snapshot cannot keep a connection to unrelated remote history.</p>
  </div>;
  const upload = onboardingImport && operation ? <p>The original upload is saved.</p> : <div className="p-upload" onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault(); if (!busy && !created && !operation && (!importLocked || onboardingImport?.requiredFile)) setFile(event.dataTransfer.files[0]);
  }}><strong>Drop a .zip project here</strong><p>Folders and file names are kept as they are. Server upload limits apply.</p>
    <Field label="Choose file" type="file" accept=".zip,application/zip" disabled={busy || Boolean(created) || Boolean(operation) || importLocked && !onboardingImport?.requiredFile} onChange={event => setFile(event.target.files?.[0])} />
    {file && <p>{file.name} · {formatBytes(file.size)}</p>}
    {onboardingImport?.requiredFile && <p>To finish uploading, reselect {onboardingImport.requiredFile.filename} ({onboardingImport.requiredFile.bytes} bytes). The saved attempt will not be replaced.</p>}
    {importLocked && !onboardingImport?.requiredFile && <p>The original upload is saved. Resume without selecting a file again.</p>}
  </div>;
  const content = { blank, template: <fieldset className="p-template-choice" aria-label="Template selection" disabled={choicesLocked}><TemplateBrowser client={client} compact {...(template ? { selection: template.id } : {})} onChoose={setTemplate} /></fieldset>, github: gitFields, upload, git: gitFields };
  return <Modal open onClose={() => { if (!busy) onClose(); }} title="New project" size="wide" className="p-create-dialog"
    footer={<div className="p-dialog-footer"><span>{template && mode === "template" ? `Selected: ${template.name}` : "Projects are private by default."}</span><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy}
      disabled={Boolean(operation) || onboardingImport?.pending || !importLocked && (!selectedEnvironment || remote && !readyGrants.some(item => item.id === grant))}
      type="submit" form="new-project-form">{created ? "Retry opening project" : importLocked ? "Resume import" : labels[mode]}</Button></div>}>
    <form id="new-project-form" className="p-stack" onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className="p-form-grid"><Field label="Project name" value={name} placeholder={projectName} disabled={choicesLocked} onChange={event => setName(event.target.value)} />
        <label className="p-field">Workspace<select aria-label="Workspace" disabled={choicesLocked} value={workspace} onChange={event => setWorkspace(event.target.value)}><option value="">Personal</option>{organizations.data?.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
          {organizations.error && <span role="alert">{organizations.error}</span>}</label></div>
      <Tabs label="How to start" value={mode} onValueChange={next => { setMode(ModeSchema.parse(next)); setGrant(""); setFile(undefined); setError(""); }} items={modes.map(item => ({ ...item, disabled: busy || Boolean(created) || Boolean(operation) || importLocked || Boolean(onboardingImport) && (item.value === "blank" || item.value === "template"), content: item.value === mode ? content[item.value] : null }))} />
      {importLocked && (!onboardingImport?.draft.engine || !onboardingImport.draft.environmentId)
        ? <p>The saved import did not specify all compiler settings. Its service defaults remain unchanged;
          open the imported project to review the resulting settings.</p>
        : <CreationSettings blank={mode === "blank"} disabled={choicesLocked}
        engine={engine} environmentId={environmentId} compatible={compatible} selected={selectedEnvironment}
        mainPath={mainPath} onMainPath={setMainPath} onEngine={next => { setEngine(next); setEnvironment(""); }} onEnvironment={setEnvironment} />}
      {environments.error && <p role="alert">{environments.error} <Button onClick={environments.reload}>Retry environments</Button></p>}
      {mode === "blank" && preferences.error && <p role="alert">{preferences.error} <Button onClick={preferences.reload}>Retry saved compiler</Button></p>}
      {onboardingImport && <p role="status">{onboardingImport.pending ? "Saving import choices..." : importLocked ? "Import attempt saved." : "Import choices saved."}</p>}
      {(error || onboardingImport?.error) && <p role="alert">{error || onboardingImport?.error}</p>}
      {created && error && <Button onClick={() => { onCreated(created); }}>Open created project to review settings</Button>}
      {operation && <OperationStatus key={operation.id} operation={operation} client={client} navigate={navigate} />}
    </form>
  </Modal>;
}
