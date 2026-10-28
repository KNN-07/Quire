import { useRef, useState } from "react";
import { endpoints, IdSchema } from "@quire/contracts";
import type { ToolsPanelProps } from "../shared";
import { editorValue } from "../shared";
import { Button, Field } from "../../../ui";
import { Feedback } from "./Feedback";
import { insertCommand } from "./insertion";
import { useTool } from "./use-tool";
import { createToolsActions } from "./actions";
import { assertGraphicBytes, figureCommand, figurePath, projectFigure } from "../visual/media";
import "./figure.css";

export function FigurePanel(props: ToolsPanelProps) {
  const state = useTool(props);
  const [path, setPath] = useState("");
  const [caption, setCaption] = useState("");
  const [label, setLabel] = useState("");
  const [width, setWidth] = useState("0.8");
  const [route, setRoute] = useState("project");
  const [device, setDevice] = useState<File | null>(null);
  const [destination, setDestination] = useState("");
  const [url, setUrl] = useState("");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [sourceFileId, setSourceFileId] = useState("");
  const latest = useRef(props);
  latest.current = props;
  const images = props.workspace.files.filter(projectFigure);
  return <section className="q-figure-panel" aria-label="Insert figure">
    <h2>Insert figure</h2>
    <p>Insert an existing project image (including saved generated output), upload original bytes, or create a linked image. PNG, JPEG and PDF work with PDF engines; EPS requires a compatible TeX environment. Insertion loads graphicx in the main document when needed.</p>
    <form className="editor-tools__stack" onSubmit={event => { event.preventDefault(); void state.run(async () => {
      if (!state.canWrite || !props.authoring || !props.document || props.document.getSnapshot().readOnly) {
        throw new TypeError("Open an editable source document before inserting.");
      }
      const document = props.document;
      const before = document.source.toJSON();
      const current = () => latest.current.document === document &&
        document.source.toJSON() === before &&
        latest.current.workspace.scope.projectId === props.workspace.scope.projectId &&
        latest.current.workspace.scope.branch === props.workspace.scope.branch;
      let selected = path;
      let asset = images.find(file => file.path === path);
      const actions = createToolsActions(props);
      if (route !== "project") {
        selected = figurePath(destination);
        // Validate fields before performing any structural write.
        figureCommand(selected, caption, label, width);
        if (route === "device") {
          if (!device) throw new TypeError("Choose one image file.");
          assertGraphicBytes(selected, new Uint8Array(await device.slice(0, 16).arrayBuffer()));
          const uploaded = await actions.upload([new File([device], selected, { type: device.type })]);
          asset = uploaded.find(file => file.path === selected);
          if (!asset) throw new TypeError("Upload did not return the chosen image.");
        } else if (route === "url") {
          const remote = new URL(url);
          if (remote.protocol !== "https:") throw new TypeError("Use a direct HTTPS image URL.");
          asset = await actions.link({ path: selected, kind: "url", url: remote.href });
        } else {
          const projectId = IdSchema.parse(sourceProjectId);
          const fileId = IdSchema.parse(sourceFileId);
          const sourceProject = editorValue(await props.client.call(endpoints.projectGet, {
            params: { p: projectId }, query: { branch: "main" }, body: undefined,
          }));
          const files = editorValue(await props.client.call(endpoints.filesList, {
            params: { p: projectId }, query: { branch: sourceProject.defaultBranch }, body: undefined,
          }));
          if (!files.some(file => file.id === sourceFileId && projectFigure(file))) {
            throw new TypeError("Choose a supported image from the source project's default branch.");
          }
          asset = await actions.link({ path: selected, kind: "project", sourceProjectId: projectId, sourceFileId: fileId });
        }
      } else if (!images.some(file => file.path === selected)) throw new TypeError("Choose an uploaded project image.");
      if (!asset) throw new TypeError("Choose an uploaded project image.");
      assertGraphicBytes(selected, await actions.download(asset));
      if (!current() || document.source.toJSON() !== before) {
        throw new TypeError(`Image saved as ${selected}. Source changed; choose the image from project images and insert again.`);
      }
      await insertCommand(props, { packageName: "graphicx", command: figureCommand(selected, caption, label, width), isCurrent: current });
      state.setMessage("Figure inserted.");
    }); }}>
      <label>Figure source<select aria-label="Figure source" value={route} disabled={state.busy} onChange={event => setRoute(event.target.value)}>
        <option value="project">This project / generated output</option>
        <option value="device">Device upload (original bytes)</option>
        <option value="url">Direct HTTPS URL (linked copy)</option>
        <option value="other">Another project (linked copy)</option>
      </select></label>
      {route === "project" ? <label>Project image<select aria-label="Project image" value={path} required onChange={event => setPath(event.target.value)}>
        <option value="">Choose a project image</option>{images.map(file => <option key={file.id} value={file.path}>{file.path}</option>)}
      </select></label> : <>
        {route === "device" && <label>Figure file<input aria-label="Figure file" type="file" accept=".png,.jpg,.jpeg,.pdf,.eps" required
          onChange={event => { const file = event.currentTarget.files?.[0] ?? null; setDevice(file); if (file) setDestination(`images/${file.name}`); }} /></label>}
        {route === "url" && <><Field label="Direct image URL" type="url" required value={url} onChange={event => setUrl(event.target.value)} />
          <p>The server fetches permitted public HTTPS URLs and stores a linked copy. Private hosts, redirects or unsupported content may be rejected; no remote URL is sent to TeX.</p></>}
        {route === "other" && <><Field label="Image source project ID" required value={sourceProjectId} onChange={event => setSourceProjectId(event.target.value)} />
          <Field label="Image source file ID" required value={sourceFileId} onChange={event => setSourceFileId(event.target.value)} />
          <p>Uses an accessible image in the source project's default branch. Refresh linked bytes in Files.</p></>}
        <Field label="Image project path" placeholder="images/diagram.png" required value={destination} onChange={event => setDestination(event.target.value)} />
      </>}
      <Field label="Caption (LaTeX)" required value={caption} onChange={event => setCaption(event.target.value)} />
      <Field label="Label" placeholder="fig:architecture" pattern="[a-zA-Z0-9_:./+\\-]+" required value={label} onChange={event => setLabel(event.target.value)} />
      <Field label="Width (fraction of line)" type="number" min="0.01" max="1" step="0.01" value={width} required onChange={event => setWidth(event.target.value)} />
      <Button type="submit" variant="primary" disabled={!state.canWrite || !props.authoring || props.document?.getSnapshot().readOnly}>Insert figure</Button>
    </form>
    <Feedback state={state} />
  </section>;
}
