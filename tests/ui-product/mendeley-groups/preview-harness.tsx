import { createRoot } from "react-dom/client";
import { useState } from "react";
import { IdSchema } from "@quire/contracts";
import type { EditorWorkspace } from "../../../apps/web/src/features/editor/shared";
import { loadEditorWorkspace, parseEditorRoute } from "../../../apps/web/src/features/editor/shared";
import { createSession } from "../../../apps/web/src/session";
import { MendeleyBibliographyPreview } from "../../../apps/web/src/features/editor/tools/MendeleyBibliographyPreview";

/** Real component and session/API; only the producer context can be switched deliberately. */
export async function mountPreview(projectId: string, fileIds: readonly string[]) {
  const session = createSession();
  await session.refresh();
  const route = parseEditorRoute(`/projects/${projectId}/edit`);
  if (!route) throw new TypeError("Actual project route required");
  const initial = await loadEditorWorkspace(session.client, route);
  const files = initial.files.filter(file => fileIds.includes(file.id));
  if (files.length !== fileIds.length || !files[0]) throw new TypeError("Actual preview files required");
  const first = files[0].id;
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const root = createRoot(container);
  function Harness() {
    const [workspace, setWorkspace] = useState<EditorWorkspace>(initial);
    const [selected, setSelected] = useState(first);
    const file = files.find(item => item.id === selected);
    if (!file) throw new TypeError("Selected actual file required");
    return <main data-preview-actor={workspace.access.actorId} data-preview-file={selected}>
      <label>Preview selected file<select aria-label="Preview selected file" value={selected}
        onChange={event => setSelected(IdSchema.parse(event.target.value))}>
        {files.map(item => <option key={item.id} value={item.id}>{item.path}</option>)}
      </select></label>
      <button onClick={() => void session.refresh().then(next => {
        // Preserve the stale workspace deliberately: the component must clear old actor bytes,
        // and its real projectAccess/fileContent requests must independently authorize again.
        setWorkspace(value => ({ ...value, access: { ...value.access, actorId: next?.user.id ?? null } }));
      })}>Refresh preview actor</button>
      <MendeleyBibliographyPreview client={session.client} workspace={workspace} file={file}
        document={null} authoring={null} label="Open selected linked bibliography"
        navigation={{
          async openFile() { throw new TypeError("A read-only preview must never open editable transport"); },
          async revealSource() { throw new TypeError("Preview has no source mutation/navigation"); },
          revealPdf() { throw new TypeError("Preview has no PDF mutation/navigation"); },
          async changeBranch() { throw new TypeError("Preview has no branch mutation/navigation"); },
        }}
        refreshWorkspace={async () => { throw new TypeError("Preview must never mutate workspace"); }} />
    </main>;
  }
  root.render(<Harness />);
  window.addEventListener("p50:preview-dispose", () => {
    root.unmount();
    window.dispatchEvent(new Event("p50:preview-disposed"));
  }, { once: true });
}
