import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { assertNever, IdSchema } from "@quire/contracts";
import type { FileEntry } from "@quire/contracts";
import type { ToolsPanelProps } from "../shared";
import { Button, Field, Modal } from "../../../ui";
import { createToolsActions, saveDownload } from "./actions";
import { Feedback } from "./Feedback";
import { FileTree } from "./FileTree";
import { useTool } from "./use-tool";

type Mode = "none" | "file" | "folder" | "rename" | "delete" | "link";
export type FilesPanelProps = ToolsPanelProps & { readonly presentation?: "standalone" | "compact" };
export function FilesPanel(props: FilesPanelProps) {
  const state = useTool(props);
  const actions = createToolsActions(props);
  const menu = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => {
    if (menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); }
  };
  const [selectedId, setSelectedId] = useState(props.document?.file.id ?? null);
  useEffect(() => { setSelectedId(props.document?.file.id ?? null); }, [props.document?.file.id]);
  const [mode, setMode] = useState<Mode>("none");
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [linkKind, setLinkKind] = useState<"url" | "project">("project");
  const [url, setUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [fileId, setFileId] = useState("");
  const selected = props.workspace.files.find(file => file.id === selectedId);
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (files.length) {
      closeMenu();
      void state.run(async () => { await actions.upload(files); state.setMessage("Files uploaded."); });
    }
  };
  const select = (file: FileEntry) => { setSelectedId(file.id); setPath(file.path); };
  const open = (file: FileEntry) => {
    void state.run(async () => {
      if (state.blocked) throw new TypeError(state.blocked);
      await props.document?.flush();
      // Binary files go through the real byte endpoint, not an empty source editor.
      if (!file.editable && !file.link) saveDownload(file, await actions.download(file));
      else await props.navigation.openFile(file.id);
    });
  };
  const begin = (next: Mode) => { closeMenu(); setPath(next === "rename" ? selected?.path ?? "" : ""); setMode(next); };
  const submit = () => state.run(async () => {
    switch (mode) {
      case "file": case "folder": {
        const file = await actions.create({ path, kind: mode === "folder" ? "folder" : "file", text });
        setSelectedId(file.id);
        break;
      }
      case "rename": if (selected) await actions.rename(selected, path); break;
      case "delete": if (selected) await actions.remove(selected); break;
      case "link":
        await actions.link(linkKind === "url" ? { path, kind: "url", url } :
          { path, kind: "project", sourceProjectId: IdSchema.parse(projectId), sourceFileId: IdSchema.parse(fileId) });
        break;
      case "none": return;
      default: assertNever(mode);
    }
    setMode("none");
    setText("");
    state.setMessage("Project files updated.");
  });
  const title = mode === "file" ? "New file" : mode === "folder" ? "New folder" :
    mode === "rename" ? "Rename or move" : mode === "delete" ? "Delete file" : "Link file";
  const selectedActions = selected && <div className="editor-tools__stack">
    <p className="editor-tools__path">{selected.path}</p>
    {selected.link && <p>Linked {selected.link.kind} file. Source is read only; rename or remove the link without changing its source.</p>}
    {!selected.editable && !selected.link && selected.kind === "file" && <p>Binary or unsupported text. Download preserves the original bytes.</p>}
    <div className="editor-tools__cluster">
      {selected.link && <Button disabled={!state.canWrite} onClick={() => void state.run(async () => {
        await actions.refreshLink(selected); state.setMessage("Linked file refreshed from its authorized source.");
      })}>Refresh linked file</Button>}
      <Button disabled={!state.canWrite} onClick={() => begin("rename")}>Rename or move</Button>
      <Button disabled={state.busy || !!state.blocked || selected.kind === "folder"}
        onClick={() => void state.run(async () => saveDownload(selected, await actions.download(selected)))}>Download</Button>
      <Button variant="danger" disabled={!state.canWrite} onClick={() => begin("delete")}>Delete</Button>
    </div>
  </div>;
  const creation = <>
    <div className="editor-tools__cluster">
      <Button disabled={!state.canWrite} onClick={() => begin("file")}>New file</Button>
      <Button disabled={!state.canWrite} onClick={() => begin("folder")}>New folder</Button>
      <Button disabled={!state.canWrite} onClick={() => begin("link")}>Link file</Button>
    </div>
    <label className="q-field">Upload files
      <input aria-label="Upload files" type="file" multiple disabled={!state.canWrite}
        onChange={upload} />
    </label>
    <label className="q-field">Upload folder
      <input aria-label="Upload folder" type="file" multiple disabled={!state.canWrite}
        ref={node => node?.setAttribute("webkitdirectory", "")} onChange={upload} />
    </label>
  </>;
  return <section aria-label="Files">
    <h2 className={props.presentation === "compact" ? "q-sr-only" : undefined}>Files</h2>
    {props.presentation === "compact" ? <details ref={menu} className="editor-tools__file-actions" onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }}>
      <summary>File actions</summary><div className="editor-tools__file-menu">{creation}{selectedActions}</div>
    </details> : creation}
    <FileTree files={props.workspace.files} selected={selectedId} disabled={state.busy || !!state.blocked} onSelect={select} onOpen={open} />
    {props.presentation !== "compact" && selectedActions}
    {mode === "none" && <Feedback state={state} />}
    <Modal open={mode !== "none"} title={title} onClose={() => { if (!state.busy) setMode("none"); }}>
      <form onSubmit={event => { event.preventDefault(); void submit(); }} className="editor-tools__stack">
        {mode === "delete" ? <p>Delete {selected?.path}? Folder contents will also be removed. This cannot be undone here.</p> :
          <Field label="Project path" value={path} required placeholder="sections/method.tex" onChange={event => setPath(event.target.value)} />}
        {mode === "file" && <label>Initial source<textarea value={text} onChange={event => setText(event.target.value)} /></label>}
        {mode === "link" && <>
          <label>Link source<select aria-label="Link source" value={linkKind} onChange={event => setLinkKind(event.target.value === "project" ? "project" : "url")}>
            <option value="project">Project file</option><option value="url">URL (requires external-link adapter)</option>
          </select></label>
          {linkKind === "url" ? <Field label="Source URL" type="url" required value={url} onChange={event => setUrl(event.target.value)} /> : <>
            <Field label="Source project ID" required value={projectId} onChange={event => setProjectId(event.target.value)} />
            <Field label="Source file ID" required value={fileId} onChange={event => setFileId(event.target.value)} />
          </>}
          <p>The server checks source access and allowed URLs. Linked files are read only.</p>
        </>}
        <Feedback state={state} />
        <div className="editor-tools__cluster">
          <Button disabled={state.busy} onClick={() => setMode("none")}>Cancel</Button>
          <Button type={mode === "delete" ? "button" : "submit"} onClick={mode === "delete" ? () => void submit() : undefined}
            variant={mode === "delete" ? "danger" : "primary"} disabled={!state.canWrite}>
            {mode === "delete" ? "Delete permanently" : mode === "rename" ? "Save path" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  </section>;
}
