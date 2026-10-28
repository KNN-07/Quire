import { useState } from "react";
import { createRoot } from "react-dom/client";
import { IdSchema } from "@quire/contracts";
import type { Diagnostic, Preferences } from "@quire/contracts";
import { createSession } from "../../../apps/web/src/session";
import { loadEditorWorkspace, parseEditorRoute } from "../../../apps/web/src/features/editor/shared";
import type { AuthoringHandle, EditorDocument, SourceSelection } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import type { EditorTransport } from "../../../apps/web/src/features/editor/transport";
import { SourcePanel } from "../../../apps/web/src/features/editor/source";
import "../../../apps/web/src/styles/tokens.css";
import "../../../apps/web/src/styles/global.css";
import "./browser.css";

const initialized = Promise.withResolvers<void>();
export const ready = initialized.promise;
const session = createSession();
let transport: EditorTransport | null = null;
let documentHandle: EditorDocument | null = null;
let authoring: AuthoringHandle | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let publishPreferences: ((value: Preferences) => void) | null = null;
let sourceChange: Promise<void> | null = null;
let publishDiagnostics: ((value: readonly Diagnostic[]) => void) | null = null;
let currentSelection: SourceSelection = { anchor: 0, head: 0 };
let spellingChange: { readonly promise: Promise<void>; readonly close: () => void } | null = null;

function untilEditable(document: EditorDocument): Promise<void> {
  return new Promise((resolve, reject) => {
    const unsubscribe = document.subscribe(check);
    const timeout = setTimeout(() => { unsubscribe(); reject(new TypeError("Document never became editable")); }, 30_000);
    function check() {
      if (document.getSnapshot().readOnly) return;
      clearTimeout(timeout); unsubscribe(); resolve();
    }
    check();
  });
}
async function boot(): Promise<void> {
  const project = IdSchema.parse(new URL(location.href).searchParams.get("project"));
  const account = await session.refresh();
  if (!account) throw new TypeError("Browser fixture requires an actual authenticated session");
  const route = parseEditorRoute(`/projects/${project}/edit`);
  if (!route) throw new TypeError("Invalid source fixture route");
  const workspace = await loadEditorWorkspace(session.client, route);
  const file = workspace.files.find(entry => entry.id === workspace.project.settings.mainFileId);
  if (!file) throw new TypeError("Actual project main file missing");
  const initialPreferences = account.preferences;
  const currentRoute = route;
  const mainFileId = file.id;
  transport = createEditorTransport({ client: session.client, workspace });
  const document = await transport.open(file);
  documentHandle = document;
  await untilEditable(document);
  const host = window.document.getElementById("source-root");
  if (!host) throw new TypeError("Fixture root missing");
  function Fixture() {
    const [preferences, setPreferences] = useState(initialPreferences);
    const [selection, setSelection] = useState<SourceSelection>({ anchor: 0, head: 0 });
    const [diagnostics, setDiagnostics] = useState<readonly Diagnostic[]>([]);
    publishPreferences = setPreferences;
    publishDiagnostics = setDiagnostics;
    return <SourcePanel client={session.client} workspace={workspace} document={document}
      preferences={preferences} onPreferencesChange={setPreferences}
      selection={selection} onSelectionChange={next => { currentSelection = next; setSelection(next); }}
      onHandle={handle => { authoring = handle; if (handle) initialized.resolve(); }}
      diagnostics={diagnostics} refreshWorkspace={async () => { await loadEditorWorkspace(session.client, currentRoute); }}
      navigation={{
        openFile: async fileId => { if (fileId !== mainFileId) throw new TypeError("This fixture opens the main source file only"); },
        revealSource: async location => { authoring?.reveal(location); },
        revealPdf: () => { throw new TypeError("PDF navigation is outside this source fixture"); },
        changeBranch: async () => { throw new TypeError("Branch changes are outside this source fixture"); },
      }} />;
  }
  root = createRoot(host);
  root.render(<Fixture />);
}
export function select(selection: SourceSelection): void {
  if (!authoring) throw new TypeError("Source handle missing");
  authoring.select(selection);
  authoring.focus();
}
export function insert(value: string): void {
  if (!authoring) throw new TypeError("Source handle missing");
  authoring.replaceSelection(value);
}
export function text(): string {
  if (!documentHandle) throw new TypeError("Source document missing");
  return documentHandle.source.toJSON();
}
export function snapshot() {
  if (!documentHandle) throw new TypeError("Source document missing");
  return documentHandle.getSnapshot();
}
export async function flush(): Promise<void> {
  if (!documentHandle) throw new TypeError("Source document missing");
  await documentHandle.flush(AbortSignal.timeout(30_000));
}
export function nextSourceContaining(expected: string): Promise<void> {
  const document = documentHandle;
  if (!document) throw new TypeError("Source document missing");
  const source = document.source;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { source.unobserve(check); reject(new TypeError("Source update not observed")); }, 30_000);
    function check() {
      if (!source.toJSON().includes(expected)) return;
      clearTimeout(timeout); source.unobserve(check); resolve();
    }
    source.observe(check);
    check();
  });
}
export function subscribeSource(expected: string): void {
  sourceChange = nextSourceContaining(expected);
}
export async function sourceObserved(): Promise<void> {
  if (!sourceChange) throw new TypeError("Subscribe to the source before performing the action");
  await sourceChange;
  sourceChange = null;
}
export function replaceAllSource(value: string): void {
  if (!documentHandle) throw new TypeError("Source document missing");
  documentHandle.replace([{ from: 0, to: documentHandle.source.length, insert: value }]);
}
export function applyPreferences(preferences: Preferences): void {
  if (!publishPreferences) throw new TypeError("Preference setter missing");
  publishPreferences(preferences);
}
export function showDiagnostics(diagnostics: readonly Diagnostic[]): void {
  if (!publishDiagnostics) throw new TypeError("Diagnostic setter missing");
  publishDiagnostics(diagnostics);
}
export const selectedRange = (): SourceSelection => currentSelection;
export function subscribeSpelling(expected: "ready" | "unavailable"): void {
  if (spellingChange) throw new TypeError("Observe the previous spelling transition first");
  const panel = window.document.querySelector(".q-source-panel");
  if (!panel) throw new TypeError("Source panel missing");
  const signal = Promise.withResolvers<void>();
  const check = () => {
    if (panel.getAttribute("data-spelling-state") !== expected) return;
    closeObservation(); signal.resolve();
  };
  const observer = new MutationObserver(check);
  const timeout = setTimeout(() => { closeObservation(); signal.reject(new TypeError(`Spelling never became ${expected}`)); }, 30_000);
  function closeObservation() { observer.disconnect(); clearTimeout(timeout); }
  spellingChange = { promise: signal.promise, close: closeObservation };
  observer.observe(panel, { attributes: true, attributeFilter: ["data-spelling-state"] });
  check();
}
export async function spellingObserved(): Promise<void> {
  if (!spellingChange) throw new TypeError("Subscribe before changing the dictionary");
  await spellingChange.promise;
  spellingChange = null;
}
export async function close(): Promise<void> {
  spellingChange?.close(); spellingChange = null;
  root?.unmount();
  await transport?.dispose();
  transport = null; root = null; documentHandle = null; authoring = null;
}
void boot().catch((error: unknown) => { initialized.reject(error); });
