import { act, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createClient, endpoints, IdSchema } from "@quire/contracts";
import { ReviewPanel } from "./index";
import { editorValue, loadEditorWorkspace } from "../shared";
import type {
  EditorDocument, EditorNavigation, EditorWorkspace, SourceSelection,
} from "../shared";
import { createEditorTransport } from "../transport";
import "../../../styles/tokens.css";
import "../../../styles/global.css";

declare global {
  interface Window {
    settleReviewEffects: typeof act;
  }
}
window.settleReviewEffects = act;

function Fixture() {
  const query = new URLSearchParams(location.search);
  const projectId = IdSchema.parse(query.get("project"));
  const fileId = IdSchema.parse(query.get("file"));
  const view = query.get("view");
  if (view !== "review" && view !== "history" && view !== "share" && view !== "chat") {
    throw new TypeError("Invalid fixture review view");
  }
  const [workspace, setWorkspace] = useState<EditorWorkspace | null>(null);
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [selection, setSelection] = useState<SourceSelection>({ anchor: 0, head: 0 });
  const [client, setClient] = useState<ReturnType<typeof createClient> | null>(null);
  const [status, setStatus] = useState("Loading review fixture");
  const route = { projectId, branch: "main", page: view === "history" ? "history" : "review",
    shareToken: null } as const;

  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => Promise<void>) | null = null;
    void (async () => {
      const bootstrap = createClient("");
      const session = editorValue(await bootstrap.call(endpoints.me, {
        params: {}, query: {}, body: undefined,
      }, controller.signal));
      const authenticated = createClient("", { csrfToken: () => session.csrfToken });
      const initial = await loadEditorWorkspace(authenticated, route, controller.signal);
      const transport = createEditorTransport({ client: authenticated, workspace: initial });
      dispose = transport.dispose;
      const file = initial.files.find(entry => entry.id === fileId);
      if (!file) throw new TypeError("Fixture file not found");
      const opened = await transport.open(file);
      const selectedText = query.get("select");
      if (selectedText) {
        const index = opened.source.toJSON().indexOf(selectedText);
        if (index < 0) throw new TypeError("Fixture selection text not found");
        setSelection({ anchor: index, head: index + selectedText.length });
      }
      if (controller.signal.aborted) return;
      setClient(authenticated); setWorkspace(initial); setDocument(opened); setStatus("Review fixture ready");
    })().catch(error => {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Fixture failed");
    });
    return () => { controller.abort(); if (dispose) void dispose(); };
  }, [fileId, projectId, view]);

  if (!client || !workspace) return <main><p role="status">{status}</p></main>;
  const refreshWorkspace = async () => setWorkspace(await loadEditorWorkspace(client, route));
  const navigation: EditorNavigation = {
    async openFile(nextFile) { setStatus(`Open file ${nextFile}`); },
    async revealSource(location) { setStatus(`Reveal line ${location.line}, column ${location.column}`); },
    revealPdf(location) { setStatus(`Reveal PDF page ${location.page}`); },
    async changeBranch(branch) { setStatus(`Change branch ${branch}`); },
  };
  return <ReadyFixture client={client} workspace={workspace} document={document}
    selection={selection} navigation={navigation} refreshWorkspace={refreshWorkspace}
    status={status} view={view} />;
}

function ReadyFixture(input: {
  readonly client: ReturnType<typeof createClient>;
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly selection: SourceSelection;
  readonly navigation: EditorNavigation;
  readonly refreshWorkspace: () => Promise<void>;
  readonly status: string;
  readonly view: "review" | "history" | "share" | "chat";
}) {
  const snapshot = useSyncExternalStore(
    input.document?.subscribe ?? (() => () => {}),
    input.document?.getSnapshot ?? (() => null),
    () => null,
  );
  return <main className="review-fixture" data-persistence={snapshot?.persistence.kind ?? "none"}>
    <p className="q-sr-only" role="status">{input.status}</p>
    <ReviewPanel client={input.client} workspace={input.workspace} document={input.document}
      selection={input.selection} navigation={input.navigation}
      refreshWorkspace={input.refreshWorkspace} view={input.view} />
  </main>;
}

const root = document.getElementById("root");
if (!root) throw new TypeError("Missing fixture root");
document.documentElement.dataset["theme"] = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
createRoot(root).render(<Fixture />);
