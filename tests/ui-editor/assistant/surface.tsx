import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { IdSchema, createClient, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { AssistantPanel } from "../../../apps/web/src/features/editor/assistant";
import { editorValue, loadEditorWorkspace } from "../../../apps/web/src/features/editor/shared";
import type { EditorDocument, EditorWorkspace, EditorRoute } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import type { EditorTransport } from "../../../apps/web/src/features/editor/transport";
import "../../../apps/web/src/styles/global.css";
import "./surface.css";

let csrf: string | null = null;
const client = createClient("", { csrfToken: () => csrf });
const projectId = IdSchema.parse(new URL(location.href).searchParams.get("project"));
const runRoute: EditorRoute = { projectId, branch: null, page: "agent", shareToken: null };
function Source({ document }: { readonly document: EditorDocument }) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  const [text, setText] = useState(document.source.toJSON());
  useEffect(() => {
    const changed = () => setText(document.source.toJSON());
    document.source.observe(changed);
    return () => document.source.unobserve(changed);
  }, [document]);
  return <section className="fixture-source"><h1>Latent Dynamics Note</h1><p>Owned HTTP provider fixture · not live inference</p>
    <p aria-label="Persistence">{snapshot.persistence.kind}</p>
    <label>Source<textarea aria-label="Source" value={text} readOnly={snapshot.readOnly} onChange={event => {
      document.replace([{ from: 0, to: document.source.length, insert: event.target.value }]);
    }} /></label>
    <pre aria-label="Persisted source display">{text}</pre>
  </section>;
}
function Surface() {
  const [workspace, setWorkspace] = useState<EditorWorkspace | null>(null);
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const transport = useRef<EditorTransport | null>(null);
  const active = useRef<EditorDocument | null>(null);
  const scope = useRef(runRoute);
  const lifetime = useRef(new AbortController());
  async function reload(fileId?: Id) {
    const next = await loadEditorWorkspace(client, scope.current, lifetime.current.signal);
    const selected = next.files.find(file => file.id === (fileId ?? active.current?.file.id ?? next.project.settings.mainFileId));
    const changedEpoch = selected && active.current && selected.version.epoch !== active.current.getSnapshot().version.epoch;
    if (!transport.current || changedEpoch || active.current?.scope.branch !== next.scope.branch) {
      await transport.current?.dispose();
      transport.current = createEditorTransport({ client, workspace: next });
    }
    setWorkspace(next);
    if (selected) {
      const opened = await transport.current.open(selected);
      active.current = opened; setDocument(opened);
    }
  }
  useEffect(() => {
    void (async () => {
      const me = editorValue(await client.call(endpoints.me, { params: {}, query: {}, body: undefined }));
      csrf = me.csrfToken;
      await reload();
    })().catch(error => { if (error instanceof Error) setFailure(error.message); else throw error; });
    const close = () => { lifetime.current.abort(); void transport.current?.dispose(); };
    window.addEventListener("pagehide", close);
    return () => { close(); window.removeEventListener("pagehide", close); };
  }, []);
  if (failure) return <p role="alert">{failure}</p>;
  if (!workspace || !document) return <p>Opening real editor transport</p>;
  return <main className="fixture-layout">
    <Source key={`${document.file.id}:${document.getSnapshot().version.epoch}`} document={document} />
    <StrictMode><AssistantPanel client={client} workspace={workspace} document={document}
      selection={{ anchor: 0, head: Math.min(12, document.source.length) }} compile={null} diagnostics={[]}
      refreshWorkspace={() => reload()} navigation={{
        openFile: id => reload(id),
        revealSource: location => reload(location.fileId),
        revealPdf: () => { throw new TypeError("PDF is outside this assistant fixture"); },
        changeBranch: async branch => { scope.current = { ...scope.current, branch }; await reload(); },
      }} /></StrictMode>
  </main>;
}
const rootElement = document.getElementById("root");
if (!rootElement) throw new TypeError("Fixture root missing");
createRoot(rootElement).render(<Surface />);
