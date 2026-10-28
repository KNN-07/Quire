import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createSession } from "../../../apps/web/src/session";
import { BrandMark, Button } from "../../../apps/web/src/ui";
import { EditorWorkspaceFrame } from "../../../apps/web/src/features/editor/workspace";
import { loadEditorWorkspace, parseEditorRoute } from "../../../apps/web/src/features/editor/shared";
import type { AuthoringHandle, EditorLayout, EditorNavigation, SourceSelection } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import type { EditorTransport } from "../../../apps/web/src/features/editor/transport";
import { SourcePanel } from "../../../apps/web/src/features/editor/source";
import { VisualPanel } from "../../../apps/web/src/features/editor/visual";
import { fixtureIds } from "../../fixtures/foundation";
import "../../../apps/web/src/styles/tokens.css";
import "../../../apps/web/src/styles/global.css";

const initialized = Promise.withResolvers<void>();
export const ready = initialized.promise;
let transport: EditorTransport | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let observation: Promise<void> | null = null;
let cancelObservation: (() => void) | null = null;

async function boot() {
  const session = createSession();
  const account = await session.refresh();
  if (!account) throw new TypeError("Geometry fixture requires an authenticated session");
  const route = parseEditorRoute(`/projects/${fixtureIds.project}/edit`);
  if (!route) throw new TypeError("Geometry fixture route is invalid");
  const initialPreferences = account.preferences;
  const userId = account.user.id;
  const currentRoute = route;
  const workspace = await loadEditorWorkspace(session.client, route);
  const file = workspace.files.find(entry => entry.id === workspace.project.settings.mainFileId);
  if (!file) throw new TypeError("Seeded project main file is missing");
  transport = createEditorTransport({ client: session.client, workspace });
  const document = await transport.open(file);
  await document.flush(AbortSignal.timeout(30_000));
  const host = window.document.getElementById("frame-root");
  if (!host) throw new TypeError("Geometry fixture root is missing");
  function Frame() {
    const [layout, setLayout] = useState<EditorLayout>("source");
    const [tools, setTools] = useState(!matchMedia("(max-width:1023px)").matches);
    const [preferences, setPreferences] = useState(initialPreferences);
    const [selection, setSelection] = useState<SourceSelection>({ anchor: 0, head: 0 });
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    const onHandle = (handle: AuthoringHandle | null) => { if (handle) initialized.resolve(); };
    const navigation: EditorNavigation = {
      openFile: async () => { throw new TypeError("File navigation belongs to assembled-browser acceptance"); },
      revealSource: async () => { throw new TypeError("Diagnostic navigation belongs to assembled-browser acceptance"); },
      revealPdf: () => { throw new TypeError("No PDF producer is mounted in this geometry-only fixture"); },
      changeBranch: async () => { throw new TypeError("Branch navigation belongs to assembled-browser acceptance"); },
    };
    const authoring = {
      client: session.client, workspace, document, preferences, onPreferencesChange: setPreferences,
      selection, onSelectionChange: setSelection, onHandle, diagnostics: [],
      navigation, refreshWorkspace: async () => { await loadEditorWorkspace(session.client, currentRoute); },
    };
    return <EditorWorkspaceFrame userId={userId} layout={layout} page="edit"
      toolsOpen={tools} onToolsOpenChange={setTools} assistantOpen={false}
      onAssistantOpenChange={() => { throw new TypeError("Assistant is outside this geometry fixture"); }}
      rail={<Button variant="ghost" onClick={() => setTools(value => !value)}>Files</Button>}
      slots={{
        header: <header className="q-header"><BrandMark /><strong>{workspace.project.name}</strong>
          <Button aria-pressed={layout === "source"} onClick={() => setLayout("source")}>Source</Button>
          <Button aria-pressed={layout === "visual"} onClick={() => setLayout("visual")}>Visual</Button></header>,
        tools: <div style={{ padding: "var(--q-space-5)" }}><h2>Files</h2><ul>
          {workspace.files.map(entry => <li key={entry.id}>{entry.path}</li>)}
        </ul></div>,
        source: layout === "source" ? <SourcePanel {...authoring} /> : null,
        visual: layout === "visual" ? <VisualPanel {...authoring} /> : null,
        pdf: null, review: null, git: null,
        status: <span>{snapshot.persistence.kind === "saved" ? "All changes saved" : document.getSnapshot().readOnlyReason}</span>,
      }} />;
  }
  root = createRoot(host);
  root.render(<Frame />);
}
export function armState(expected: "drawer-open" | "drawer-closed" | "visual" | "tree-width"): void {
  const previous = window.document.querySelector(".qe-workspace")?.getAttribute("style");
  const pending = Promise.withResolvers<void>();
  const observer = new MutationObserver(check);
  const timeout = setTimeout(() => { observer.disconnect(); pending.reject(new TypeError(`Frame state not observed: ${expected}`)); }, 30_000);
  function check() {
    let matched;
    switch (expected) {
      case "drawer-open": matched = !!window.document.querySelector("dialog[open]"); break;
      case "drawer-closed": matched = !window.document.querySelector("dialog[open]"); break;
      case "visual": matched = !!window.document.querySelector(".q-visual"); break;
      case "tree-width": matched = window.document.querySelector(".qe-workspace")?.getAttribute("style") !== previous; break;
    }
    if (!matched) return;
    observer.disconnect(); clearTimeout(timeout); pending.resolve();
  }
  observer.observe(window.document, { subtree: true, childList: true, attributes: true });
  observation = pending.promise;
  cancelObservation = () => { observer.disconnect(); clearTimeout(timeout); };
}
export async function observed(): Promise<void> {
  if (!observation) throw new TypeError("Subscribe before triggering a frame action");
  await observation;
  observation = null;
  cancelObservation = null;
}
export async function close(): Promise<void> {
  cancelObservation?.();
  root?.unmount();
  await transport?.dispose();
  root = null; transport = null;
}
void boot().catch((cause: unknown) => initialized.reject(cause));
