import { createRoot } from "react-dom/client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createSession } from "../../../apps/web/src/session";
import { loadEditorWorkspace } from "../../../apps/web/src/features/editor/shared";
import type { AuthoringHandle, DocumentSnapshot, SourceSelection } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import { VisualPanel } from "../../../apps/web/src/features/editor/visual";
import { fixtureIds } from "../../fixtures/foundation";
import "../../../apps/web/src/styles/global.css";
import "./harness.css";

export type VisualHarness = {
  readonly armSave: () => void;
  readonly saved: () => Promise<void>;
  readonly text: () => string;
  readonly snapshot: () => DocumentSnapshot;
  readonly dispose: () => Promise<void>;
};
declare global {
  interface Window { visualHarness: VisualHarness; visualReady: Promise<void> }
}
const initial = String.raw`\documentclass{article}
%  exact comment   \custom{not interpreted}
\newcommand{\strange}[2]{#1 + #2}
\begin{document}
\section{Round trip}
Editable paragraph 😀 with \textbf{strong words} and \emph{emphasis}.

\strange [z] { unknown  source }

\begin{itemize}
\item First item
\item Second item
\end{itemize}
$x^2 + y^2$ \cite{ha2018world} \ref{fig:test}
\input{sections/intro}
\begin{tabular}{lc}
Alpha & Beta \\
One & Two \\
\end{tabular}
\begin{unrecognized}  raw   {source}
% keep this too
\end{unrecognized}
\end{document}
`;
async function main() {
  const session = createSession();
  const me = await session.refresh();
  if (!me) throw new TypeError("Fixture needs an authenticated session");
  const preferences = me.preferences;
  const route = { projectId: fixtureIds.project, branch: "main", page: "edit", shareToken: null } as const;
  let workspace = await loadEditorWorkspace(session.client, route);
  const transport = createEditorTransport({ client: session.client, workspace });
  const file = workspace.files.find(entry => entry.id === fixtureIds.mainFile);
  if (!file) throw new TypeError("Main fixture file missing");
  const document = await transport.open(file);
  await new Promise<void>((resolve, reject) => {
    const signal = AbortSignal.timeout(10_000);
    const fail = () => { unsubscribe(); reject(signal.reason); };
    const unsubscribe = document.subscribe(() => {
      if (document.getSnapshot().persistence.kind !== "saved") return;
      unsubscribe(); signal.removeEventListener("abort", fail); resolve();
    });
    signal.addEventListener("abort", fail, { once: true });
    if (document.getSnapshot().persistence.kind === "saved") {
      unsubscribe(); signal.removeEventListener("abort", fail); resolve();
    }
  });
  if (new URL(location.href).searchParams.get("reset") === "true") {
    document.replace([{ from: 0, to: document.source.length, insert: initial }]);
    await document.flush(AbortSignal.timeout(10_000));
  }
  let pending = Promise.resolve();
  window.visualHarness = {
    armSave() {
      pending = new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(15_000);
        const failed = () => { document.source.unobserve(changed); reject(signal.reason); };
        const changed = () => {
          document.source.unobserve(changed);
          // Y.Text observers precede Y.Doc's update event and its persistence queue.
          queueMicrotask(() => {
            void document.flush(signal).then(() => {
              signal.removeEventListener("abort", failed); resolve();
            }, reject);
          });
        };
        document.source.observe(changed);
        signal.addEventListener("abort", failed, { once: true });
      });
    },
    saved: () => pending,
    text: () => document.source.toJSON(),
    snapshot: document.getSnapshot,
    dispose: () => transport.dispose(),
  };
  function Harness() {
    useEffect(() => { window.dispatchEvent(new Event("visual-ready")); }, []);
    const [mode, setMode] = useState("visual");
    const [selection, setSelection] = useState<SourceSelection>({ anchor: 0, head: 0 });
    const [current, setWorkspace] = useState(workspace);
    const [handle, setHandle] = useState<AuthoringHandle | null>(null);
    const status = useSyncExternalStore(document.subscribe, document.getSnapshot);
    const text = useSyncExternalStore(listener => {
      document.source.observe(listener); return () => document.source.unobserve(listener);
    }, () => document.source.toJSON());
    return <main className="visual-harness">
      <header><h1>Visual authoring fixture</h1>
        <button onClick={() => setMode(mode === "visual" ? "source" : "visual")}>
          {mode === "visual" ? "Show source" : "Show visual"}
        </button>
        <button onClick={() => handle?.focus()} disabled={!handle}>Focus editor</button>
        <output aria-label="Persistence">{status.persistence.kind}</output>
      </header>
      {mode === "visual" ? <VisualPanel client={session.client} workspace={current} document={document}
        navigation={{
          openFile: async () => { throw new TypeError("No file navigation in the bounded harness"); },
          revealSource: async () => { throw new TypeError("No source navigation in the bounded harness"); },
          revealPdf: () => { throw new TypeError("No PDF in the bounded harness"); },
          changeBranch: async () => { throw new TypeError("No branch change in the bounded harness"); },
        }}
        refreshWorkspace={async () => {
          workspace = await loadEditorWorkspace(session.client, route); setWorkspace(workspace);
        }}
        preferences={preferences} onPreferencesChange={() => { throw new TypeError("No preference changes in this fixture"); }}
        selection={selection} onSelectionChange={setSelection} onHandle={setHandle} diagnostics={[]} />
        : <textarea className="visual-harness-source" aria-label="Source fixture" value={text}
          onChange={event => document.replace([{ from: 0, to: document.source.length, insert: event.currentTarget.value }])} />}
    </main>;
  }
  const root = documentRoot();
  createRoot(root).render(<Harness />);
}
function documentRoot() {
  const root = globalThis.document.getElementById("root");
  if (!root) throw new TypeError("Fixture root missing");
  return root;
}
void main().catch((error: unknown) => {
  if (!(error instanceof Error)) throw error;
  globalThis.document.body.textContent = error.stack ?? error.message;
  throw error;
});
