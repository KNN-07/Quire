import { createRoot } from "react-dom/client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Id } from "@quire/contracts";
import { createSession } from "../../../apps/web/src/session";
import { loadEditorWorkspace, parseEditorRoute } from "../../../apps/web/src/features/editor/shared";
import type { AuthoringHandle, AuthoringProps, EditorDocument, SourceSelection } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import { SourcePanel } from "../../../apps/web/src/features/editor/source/SourcePanel";
import { VisualPanel } from "../../../apps/web/src/features/editor/visual";
import { FigurePanel } from "../../../apps/web/src/features/editor/tools/FigurePanel";
import "../../../apps/web/src/styles/global.css";
import "../../../apps/web/src/features/editor/tools/tools.css";
import "../visual/harness.css";

export async function mountMedia(projectId: string) {
  const session = createSession();
  const me = await session.refresh();
  if (!me) throw new TypeError("Authentication required");
  const preferences = me.preferences;
  const parsed = parseEditorRoute(`/projects/${projectId}/edit`);
  if (!parsed) throw new TypeError("Invalid project route");
  const route = parsed;
  const initial = await loadEditorWorkspace(session.client, route);
  const transport = createEditorTransport({ client: session.client, workspace: initial });
  const main = initial.files.find(file => file.id === initial.project.settings.mainFileId);
  if (!main) throw new TypeError("Main file missing");
  const document = await transport.open(main);
  await document.flush(AbortSignal.timeout(30_000));
  const container = globalThis.document.createElement("div");
  globalThis.document.body.replaceChildren(container);
  const root = createRoot(container);
  let active: EditorDocument = document;
  let openFile: (id: Id) => Promise<void> = async () => { throw new TypeError("Media harness has not mounted"); };
  function Harness() {
    const [workspace, setWorkspace] = useState(initial);
    const [current, setCurrent] = useState(document);
    active = current;
    const [selection, setSelection] = useState<SourceSelection>({ anchor: 0, head: 0 });
    const [handle, setHandle] = useState<AuthoringHandle | null>(null);
    const [mode, setMode] = useState("source");
    const snapshot = useSyncExternalStore(current.subscribe, current.getSnapshot);
    const text = useSyncExternalStore(listener => {
      current.source.observe(listener); return () => current.source.unobserve(listener);
    }, () => current.source.toJSON());
    const props: AuthoringProps = {
      client: session.client, workspace, document: current, selection, onSelectionChange: setSelection,
      onHandle: setHandle, preferences, onPreferencesChange: () => {},
      diagnostics: [], refreshWorkspace: async () => setWorkspace(await loadEditorWorkspace(session.client, route)),
      navigation: {
        openFile: async id => {
          const file = workspace.files.find(entry => entry.id === id);
          if (!file) throw new TypeError("File missing");
          await current.flush(); setCurrent(await transport.open(file));
        },
        revealSource: async () => {}, revealPdf: () => {}, changeBranch: async () => {},
      },
    };
    openFile = props.navigation.openFile;
    useEffect(() => { globalThis.dispatchEvent(new Event("media:ready")); }, []);
    return <main className="visual-harness" data-persistence={snapshot.persistence.kind}>
      <header><button onClick={() => setMode(mode === "source" ? "visual" : "source")}>Show {mode === "source" ? "visual" : "source"}</button>
        <button onClick={() => handle?.select({ anchor: text.indexOf("\\end{document}"), head: text.indexOf("\\end{document}") })}>Select document end</button>
        <button onClick={() => handle?.select({ anchor: 0, head: text.length })}>Select all source</button>
      </header>
      <div style={{ overflow: "auto" }}>
        <FigurePanel client={session.client} workspace={workspace} document={current} authoring={handle}
          navigation={props.navigation} refreshWorkspace={props.refreshWorkspace} />
        {mode === "source" ? <SourcePanel {...props} /> : <VisualPanel {...props} />}
      </div>
      <output aria-label="Exact source" style={{ display: "none" }}>{text}</output>
    </main>;
  }
  root.render(<Harness />);
  return {
    text: () => active.source.toJSON(),
    flush: () => active.flush(AbortSignal.timeout(30_000)),
    openFile: (id: Id) => openFile(id),
    reset: async (text: string) => { active.replace([{ from: 0, to: active.source.length, insert: text }]); await active.flush(); },
    dispose: async () => { root.unmount(); await transport.dispose(); },
  };
}
