import { createRoot } from "react-dom/client";
import { endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { createSession } from "../../../apps/web/src/session";
import { editorValue, loadEditorWorkspace, parseEditorRoute } from "../../../apps/web/src/features/editor/shared";
import type { CompileController, EditorDocument, EditorNavigation, SourceLocation } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import { PdfCompileController, PdfPanel } from "../../../apps/web/src/features/editor/pdf";
import type { PdfPanelHandle } from "../../../apps/web/src/features/editor/pdf";
import "../../../apps/web/src/styles/tokens.css";
import "../../../apps/web/src/styles/global.css";
import "./harness.css";

function saved(document: EditorDocument): Promise<void> {
  return new Promise((resolve, reject) => {
    const unsubscribe = document.subscribe(check);
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Durable document initialization timed out")); }, 30_000);
    function check() {
      if (document.getSnapshot().persistence.kind !== "saved") return;
      unsubscribe(); clearTimeout(timeout); resolve();
    }
    check();
  });
}
export async function mountPdf(projectId: Id, activeFile = true) {
  const session = createSession();
  await session.refresh();
  const route = parseEditorRoute(`/projects/${projectId}/edit`);
  if (!route) throw new TypeError("Invalid PDF test route");
  const workspace = await loadEditorWorkspace(session.client, route);
  const transport = createEditorTransport({ client: session.client, workspace });
  const main = workspace.files.find(file => file.id === workspace.project.settings.mainFileId);
  if (!main) throw new TypeError("Main file missing");
  const document = await transport.open(main);
  try { await saved(document); }
  catch (error) { await transport.dispose(); throw error; }
  const preferences = editorValue(await session.client.call(endpoints.preferencesGet, { params: {}, query: {}, body: undefined }));
  const element = window.document.createElement("div");
  element.className = "pdf-test-host";
  window.document.body.append(element);
  const root = createRoot(element);
  const ready = Promise.withResolvers<CompileController>();
  let viewer: PdfPanelHandle | null = null;
  let controller: CompileController | null = null;
  const revealed: SourceLocation[] = [];
  const navigation: EditorNavigation = {
    openFile: async () => {},
    changeBranch: async () => {},
    revealSource: async location => {
      revealed.push(location);
      window.document.dispatchEvent(new Event("pdf-source-revealed"));
    },
    revealPdf: location => viewer?.reveal(location),
  };
  root.render(<PdfPanel client={session.client} workspace={workspace} document={activeFile ? document : null}
    preferences={preferences} navigation={navigation} onViewer={handle => { viewer = handle; }}
    sourceLocation={{ fileId: main.id, line: 3, column: 1 }}
    onController={handle => { controller = handle; if (handle) ready.resolve(handle); }}
    onCompileStateChange={() => {}} />);
  const compile = await ready.promise;
  const fixture = {
    client: session.client, workspace, document, transport, revealed,
    get controller() { return controller ?? compile; },
    get viewer() { return viewer; },
    async edit(text: string) {
      document.replace([{ from: 0, to: document.source.length, insert: text }]);
      await document.flush(AbortSignal.timeout(30_000));
    },
    async dispose() {
      root.unmount();
      if (controller instanceof PdfCompileController) await controller.dispose();
      else if (compile instanceof PdfCompileController) await compile.dispose();
      // Unmount aborts the PDF stream; transport owns the document and socket.
      await transport.dispose();
      element.remove();
    },
  };
  window.pdfFixture = fixture;
  return fixture;
}
declare global {
  interface Window {
    pdfFixture: Awaited<ReturnType<typeof mountPdf>>;
    pdfSourceWait: Promise<void>;
  }
}
