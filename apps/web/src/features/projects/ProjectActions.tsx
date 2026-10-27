import { useState } from "react";
import { assertNever, endpoints, resourceVersionTag, TagSchema } from "@quire/contracts";
import type { ProjectSummary, Tag } from "@quire/contracts";
import { Button, Field, Modal } from "../../ui";
import { errorMessage, mutationHeaders, value } from "./api";
import type { ProjectsPageProps } from "./api";

export function ProjectActions({ project, tags, client, onClose, onChanged, navigate }: {
  readonly project: ProjectSummary;
  readonly tags: readonly Tag[];
  readonly client: ProjectsPageProps["client"];
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly navigate: ProjectsPageProps["navigate"];
}) {
  const [name, setName] = useState(project.name);
  const [confirmation, setConfirmation] = useState("");
  const [selectedTags, setSelectedTags] = useState<readonly Tag[]>(tags.filter(tag => project.tagIds.includes(tag.id)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: "rename" | "copy" | "delete" | "leave" | "tags") {
    setBusy(true); setError("");
    try {
      const latest = project;
      switch (action) {
        case "rename":
          value(await client.call(endpoints.projectPatch, { params: { p: latest.id }, query: {}, body: { name, expectedVersion: latest.version }, headers: {} }));
          onChanged(); onClose(); return;
        case "copy": {
          const copy = value(await client.call(endpoints.projectCopy, { params: { p: latest.id }, query: {}, body: { name, expectedVersion: latest.version }, headers: mutationHeaders() }));
          onChanged(); navigate(`/projects/${copy.id}/edit`); return;
        }
        case "delete":
          value(await client.call(endpoints.projectDelete, { params: { p: latest.id }, query: {}, body: { confirmation, expectedVersion: latest.version }, headers: {} }));
          onChanged(); onClose(); return;
        case "leave":
          value(await client.call(endpoints.projectLeave, { params: { p: latest.id }, query: {}, body: { expectedVersion: latest.version }, headers: {} }));
          onChanged(); onClose(); return;
        case "tags":
          value(await client.call(endpoints.projectTags, { params: { p: latest.id }, query: {}, body: { tagIds: selectedTags.map(tag => tag.id), expectedVersion: latest.version }, headers: { "if-match": resourceVersionTag(latest.version) } }));
          onChanged(); onClose(); return;
        default: assertNever(action);
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <Modal open title="Project actions" onClose={onClose}>
    <div className="p-stack">
      <strong>{project.name}</strong>
      <Field label="Project title" value={name} onChange={event => setName(event.target.value)} />
      <div className="p-cluster">{["owner", "editor"].includes(project.role) && <Button disabled={busy || !name.trim()} onClick={() => void act("rename")}>Rename</Button>}<Button disabled={busy || !name.trim()} onClick={() => void act("copy")}>Make a copy</Button></div>
      <fieldset><legend>Project tags</legend>
        {tags.map(tag => <label className="p-check" key={tag.id}><input type="checkbox" checked={selectedTags.includes(tag)} onChange={event => setSelectedTags(previous => event.target.checked ? [...previous, tag] : previous.filter(item => item.id !== tag.id))} />{tag.name}</label>)}
        <Button disabled={busy} onClick={() => void act("tags")}>Replace tags</Button>
      </fieldset>
      {project.role !== "owner" && <Button disabled={busy} onClick={() => void act("leave")}>Leave project</Button>}
      {project.role === "owner" && <><Field label="Type the project title to permanently delete" value={confirmation} onChange={event => setConfirmation(event.target.value)} />
      <Button variant="danger" disabled={busy || confirmation !== project.name} onClick={() => void act("delete")}>Permanently delete</Button></>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}

export function TagDialog({ client, tag, onClose, onChanged }: {
  readonly client: ProjectsPageProps["client"];
  readonly tag?: Tag;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.colorHex ?? "#2F4FD6");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(remove = false) {
    setBusy(true); setError("");
    try {
      const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color.trim());
      const channels = rgb?.slice(1).map(Number);
      if (!remove && channels?.some(channel => channel > 255)) { setError("RGB channels must be between 0 and 255."); return; }
      const colorHex = remove && tag ? tag.colorHex : TagSchema.unwrap().shape.colorHex.parse(channels ? `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}` : color.trim());
      if (tag) {
        const latest = tag;
        if (remove) value(await client.call(endpoints.tagDelete, { params: { id: tag.id }, query: {}, body: { expectedVersion: latest.version }, headers: {} }));
        else value(await client.call(endpoints.tagPatch, { params: { id: tag.id }, query: {}, body: { name, colorHex, expectedVersion: latest.version }, headers: {} }));
      } else value(await client.call(endpoints.tagCreate, { params: {}, query: {}, body: { name, colorHex }, headers: mutationHeaders() }));
      onChanged(); onClose();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <Modal open title={tag ? "Edit tag" : "New tag"} onClose={onClose}>
    <form className="p-stack" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field label="Tag name" required value={name} onChange={event => setName(event.target.value)} />
      <Field label="Tag color (HEX or RGB)" required value={color} onChange={event => setColor(event.target.value)} />
      <Button variant="primary" type="submit" busy={busy}>Save tag</Button>
      {tag && <Button variant="danger" disabled={busy} onClick={() => void save(true)}>Delete tag</Button>}
      {error && <p role="alert">{error}</p>}
    </form>
  </Modal>;
}
