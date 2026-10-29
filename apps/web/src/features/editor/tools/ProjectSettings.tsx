import { useEffect, useState } from "react";
import { EngineSchema, IdSchema, endpoints } from "@quire/contracts";
import type { z } from "zod";
import { EditorApiError, editorValue } from "../shared";
import type { ToolsPanelProps } from "../shared";
import { Button, Field } from "../../../ui";
import { createToolsActions } from "./actions";
import { Feedback } from "./Feedback";
import { useTool } from "./use-tool";

export function ProjectSettings(props: ToolsPanelProps) {
  const state = useTool(props);
  const [settings, setSettings] = useState(props.workspace.project.settings);
  const [baseline, setBaseline] = useState({ settings: props.workspace.project.settings, name: props.workspace.project.name });
  const [name, setName] = useState(props.workspace.project.name);
  const [environments, setEnvironments] = useState<z.output<typeof endpoints.environmentsAdmission.output> | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void state.run(async () => {
      try {
        const list = editorValue(await props.client.call(endpoints.environmentsAdmission, { params: {}, query: {}, body: undefined }, abort.signal));
        if (!abort.signal.aborted) setEnvironments(list);
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      }
    });
    return () => abort.abort();
  }, [props.client, state.run]);
  const admission = environments?.find(item => item.environment.id === settings.environmentId);
  const environment = admission?.environment;
  const mains = props.workspace.files.filter(file => file.editable && !file.link && file.kind === "file" &&
    (/\.tex$/i.test(file.path) || (["main.Rnw", "main.Rtex"].includes(file.path) && environment?.backend === "docker" && environment.helpers.includes("knitr"))));
  const mainEligible = mains.some(file => file.id === settings.mainFileId);
  const canRename = props.workspace.access.role === "owner";
  const defaultBranch = props.workspace.scope.branch === props.workspace.project.defaultBranch;
  return <section aria-label="Project settings">
    <h2>Project settings</h2>
    {!defaultBranch && <p>Project-wide settings use files from {props.workspace.project.defaultBranch}. Switch to that branch before changing them.</p>}
    <form className="editor-tools__stack" onSubmit={event => {
      event.preventDefault();
      void state.run(async () => {
        if (!admission?.selectable) throw new EditorApiError("ENVIRONMENT_NOT_ADMITTED", "Choose an executable environment before saving.");
        await createToolsActions(props).ready(true);
        const current = editorValue(await props.client.call(endpoints.projectGet, {
          params: { p: props.workspace.project.id }, query: { branch: props.workspace.scope.branch },
          headers: props.workspace.requestHeaders, body: undefined,
        }));
        const renaming = canRename && name !== baseline.name;
        if (JSON.stringify(current.settings) !== JSON.stringify(baseline.settings) || (renaming && current.name !== baseline.name)) {
          throw new EditorApiError("SETTINGS_CHANGED", "Project settings changed elsewhere. Reopen settings and review them before saving.");
        }
        const saved = editorValue(await props.client.call(endpoints.projectPatch, {
          params: { p: props.workspace.project.id }, query: {}, headers: props.workspace.requestHeaders,
          body: { settings, expectedVersion: current.version, ...(renaming ? { name } : {}) },
        }));
        setSettings(saved.settings); setName(saved.name); setBaseline({ settings: saved.settings, name: saved.name });
        await props.refreshWorkspace();
        state.setMessage("Project settings saved.");
      });
    }}>
      <fieldset className="editor-tools__stack" disabled={!state.canWrite || !defaultBranch}>
        {canRename ? <Field label="Project name" required value={name} onChange={event => setName(event.target.value)} /> :
          <p>Only the project owner can rename this project.</p>}
        <label>Compiler engine<select aria-label="Compiler engine" value={settings.engine}
          onChange={event => setSettings({ ...settings, engine: EngineSchema.parse(event.target.value) })}>
          {EngineSchema.options.map(engine => <option key={engine} value={engine} disabled={environment ? !environment.engines.includes(engine) : false}>{engine}</option>)}
        </select></label>
        <label>Main document<select aria-label="Main document" value={settings.mainFileId}
          onChange={event => setSettings({ ...settings, mainFileId: IdSchema.parse(event.target.value) })}>
          {!mainEligible && <option value={settings.mainFileId} disabled>Choose a compatible main document</option>}
          {mains.map(file => <option key={file.id} value={file.id}>{file.path}</option>)}
        </select></label>
        <label>TeX environment<select aria-label="TeX environment" value={settings.environmentId}
          onChange={event => setSettings({ ...settings, environmentId: IdSchema.parse(event.target.value) })}>
          {environments && !admission && <option value={settings.environmentId} disabled>Current environment is unavailable</option>}
          {environments?.map(item => <option key={item.environment.id} value={item.environment.id} disabled={!item.selectable}>
            {item.environment.label} · {item.environment.release}{item.selectable ? "" : item.probe !== "ready" ? " (toolchain unavailable)" : " (signed admission required)"}
          </option>)}
        </select></label>
        {!environments && <p>Loading installed environments.</p>}
        {environment && admission && <p>Toolchain: {admission.probe}. Execution: {admission.execution.state === "admitted"
          ? "signed execution admission" : admission.execution.state === "not-admitted" ? "signed admission required" : "unmanaged deployment"} · {environment.backend}{environment.experimental ? " · experimental" : ""}</p>}
        <label><input type="checkbox" checked={settings.draft} onChange={event => setSettings({ ...settings, draft: event.target.checked })} /> Draft mode (skip figure rendering)</label>
        <label><input type="checkbox" checked={settings.stopOnFirstError} onChange={event => setSettings({ ...settings, stopOnFirstError: event.target.checked })} /> Stop on first error</label>
        <Button type="submit" variant="primary" disabled={!admission?.selectable || !mainEligible || !environment?.engines.includes(settings.engine)}>Save project settings</Button>
      </fieldset>
    </form>
    <Feedback state={state} />
  </section>;
}
