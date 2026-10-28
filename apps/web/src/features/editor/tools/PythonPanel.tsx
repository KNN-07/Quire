import { useEffect, useRef, useState } from "react";
import { endpoints, ProjectPathSchema } from "@quire/contracts";
import type { ToolsPanelProps } from "../shared";
import { editorValue } from "../shared";
import { Button, Field } from "../../../ui";
import { createToolsActions, saveDownload } from "./actions";
import { Feedback } from "./Feedback";
import { executePython } from "./python";
import { PythonInstallationSchema } from "./python-contract";
import type { PythonInstallation, PythonResult } from "./python-contract";
import { useTool } from "./use-tool";

const storageKey = "quire.python.installation";
export function PythonPanel(props: ToolsPanelProps) {
  const state = useTool(props);
  const [installation, setInstallation] = useState<PythonInstallation>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try { return PythonInstallationSchema.parse(JSON.parse(saved)); }
      catch (error) { if (!(error instanceof Error)) throw error; }
    }
    return { enabled: false, indexURL: new URL("/extensions/pyodide/", location.origin).href, version: "" };
  });
  const [script, setScript] = useState("");
  const [inputs, setInputs] = useState<ReadonlySet<string>>(new Set());
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  const [destinations, setDestinations] = useState<Readonly<Record<string, string>>>({});
  const [result, setResult] = useState<PythonResult | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return <section aria-label="Browser Python">
    <h2>Browser Python</h2>
    <p>Opt-in installed extension. An operator must host matching pinned Pyodide core and standard-library assets on this origin.
      Configure its directory and exact runtime version below. The core runtime loads from that directory only when you run a selected script.</p>
    <p>Scientific wheels are not included in the core installation. Missing optional imports report a Python error; they are not installed automatically.</p>
    <p>Python runs in a separate disposable browser worker, not the TeX server. Only selected inputs are copied to /inputs.
      Write generated files under /outputs. Scripts can use browser networking. Review outputs before any project write.</p>
    <form className="editor-tools__stack" onSubmit={event => {
      event.preventDefault();
      void state.run(async () => {
        const config = PythonInstallationSchema.parse(installation);
        const url = new URL(config.indexURL);
        if (url.origin !== location.origin || !url.pathname.endsWith("/")) throw new TypeError("Runtime directory must be same-origin and end in /.");
        localStorage.setItem(storageKey, JSON.stringify(config));
        state.setMessage("Browser installation configuration saved. Execution verifies the installed runtime version.");
      });
    }}>
      <Field label="Installed runtime directory" type="url" required value={installation.indexURL} onChange={event => setInstallation({ ...installation, indexURL: event.target.value })} />
      <Field label="Pinned Pyodide version" required value={installation.version} placeholder="Operator-installed version" onChange={event => setInstallation({ ...installation, version: event.target.value })} />
      <label><input type="checkbox" checked={installation.enabled} onChange={event => setInstallation({ ...installation, enabled: event.target.checked })} /> Enable browser Python on this browser</label>
      <Button type="submit" disabled={state.busy}>Save installation configuration</Button>
    </form>
    <label>Project Python script<select aria-label="Project Python script" value={script} onChange={event => setScript(event.target.value)}>
      <option value="">Choose a .py file</option>{props.workspace.files.filter(file => file.editable && /\.py$/i.test(file.path)).map(file =>
        <option key={file.id} value={file.id}>{file.path}</option>)}
    </select></label>
    <fieldset disabled={state.busy}><legend>Inputs copied to the worker</legend>
      {props.workspace.files.filter(file => file.kind === "file").map(file => <label key={file.id}>
        <input type="checkbox" checked={inputs.has(file.id)} onChange={event => {
          const next = new Set(inputs); if (event.target.checked) next.add(file.id); else next.delete(file.id); setInputs(next);
        }} />{file.path}
      </label>)}
    </fieldset>
    <div className="editor-tools__cluster">
      <Button variant="primary" disabled={!installation.enabled || !installation.version || !script || state.busy || !!state.blocked}
        onClick={() => void state.run(async () => {
          const abort = new AbortController(); active.current = abort;
          try {
            await createToolsActions(props).ready(false, abort.signal);
            const file = props.workspace.files.find(item => item.id === script);
            if (!file) throw new TypeError("Selected Python script is no longer available.");
            const source = editorValue(await props.client.call(endpoints.fileDocument, {
              params: { p: props.workspace.scope.projectId, f: file.id }, query: { branch: props.workspace.scope.branch },
              headers: props.workspace.requestHeaders, body: undefined,
            }, abort.signal));
            const copied = await Promise.all(props.workspace.files.filter(item => inputs.has(item.id)).map(async item => ({
              path: item.path, bytes: await createToolsActions(props).download(item, abort.signal),
            })));
            setResult(null); setApproved(new Set()); setDestinations({});
            const execution = await executePython({ installation, source: source.text, inputs: copied }, abort.signal);
            setResult(execution);
          } finally { active.current = null; }
        })}>Run selected Python</Button>
      <Button disabled={!state.busy} onClick={() => active.current?.abort()}>Cancel execution</Button>
    </div>
    {result?.kind === "error" && <p role="alert">{result.message}</p>}
    {result?.kind === "complete" && <section aria-label="Generated file review" className="editor-tools__stack">
      <h3>Generated file review</h3><pre>{result.stdout.join("\n") || "No console output."}</pre>
      {!props.workspace.access.capabilities.edit && <p>This project is read only. You can inspect or download outputs; saving requires editing access.</p>}
      {result.files.length === 0 && <p>The script generated no files under /outputs. No project files changed.</p>}
      {result.files.map(file => <div key={file.path} className="editor-tools__stack">
        <Field label={`Project path for ${file.path}`} value={destinations[file.path] ?? file.path} onChange={event => {
          setDestinations(previous => ({ ...previous, [file.path]: event.target.value }));
          setApproved(previous => new Set([...previous].filter(path => path !== file.path)));
        }} />
        {props.workspace.files.some(item => item.path === (destinations[file.path] ?? file.path)) &&
          <p>That path already exists. Choose a new path; the upload API does not replace existing files.</p>}
        <label><input type="checkbox" checked={approved.has(file.path)}
          disabled={props.workspace.files.some(item => item.path === (destinations[file.path] ?? file.path))}
          onChange={event => {
          const next = new Set(approved); if (event.target.checked) next.add(file.path); else next.delete(file.path); setApproved(next);
        }} />Approve {file.path} ({file.bytes.byteLength} bytes) as a new project file</label>
        <details><summary>Inspect output bytes</summary><pre>{Array.from(file.bytes.slice(0, 256), value => value.toString(16).padStart(2, "0")).join(" ")}</pre></details>
        <Button onClick={() => saveDownload({ path: file.path, mime: "application/octet-stream" }, file.bytes)}>Download {file.path} for review</Button>
      </div>)}
      <div className="editor-tools__cluster"><Button disabled={!state.canWrite || approved.size === 0} onClick={() => void state.run(async () => {
        await createToolsActions(props).upload(result.files.filter(file => approved.has(file.path)).map(file =>
          new File([new Uint8Array(file.bytes)], ProjectPathSchema.parse(destinations[file.path] ?? file.path), { type: "application/octet-stream" })));
        setResult(null); setApproved(new Set()); state.setMessage("Approved generated files saved to the project.");
      })}>Save approved files</Button>
      <Button disabled={state.busy} onClick={() => { setResult(null); setApproved(new Set()); }}>Discard generated files</Button></div>
    </section>}
    <Feedback state={state} />
  </section>;
}
