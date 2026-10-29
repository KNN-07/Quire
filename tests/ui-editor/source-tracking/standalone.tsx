import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { ySyncFacet } from "y-codemirror.next";
import { endpoints } from "@quire/contracts";
import { createSession } from "../../../apps/web/src/session";
import { SourcePanel } from "../../../apps/web/src/features/editor/source";
import { loadEditorWorkspace, parseEditorRoute } from "../../../apps/web/src/features/editor/shared";
import { EditorApiError } from "../../../apps/web/src/features/editor/shared";
import type { AuthoringHandle, SourceSelection } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import { createToolsActions } from "../../../apps/web/src/features/editor/tools/actions";
import { insertCommand } from "../../../apps/web/src/features/editor/tools/insertion";
import { sourceToolsClient } from "../../../apps/web/src/features/editor/source/tools-client";
import { draftKey, readDraft } from "../../../apps/web/src/features/editor/source/tracking";
import "../../../apps/web/src/styles/tokens.css";
import "../../../apps/web/src/styles/global.css";

const initialized = Promise.withResolvers<void>();
export const ready = initialized.promise;
const session = createSession();
const route = parseEditorRoute(`/projects/${new URL(location.href).searchParams.get("project")}/edit`);
if (!route) throw new Error("Missing project route");
const account = await session.refresh();
if (!account) throw new Error("A real authenticated account is required");
const workspace = await loadEditorWorkspace(session.client, route);
const file = workspace.files.find(entry => entry.id === workspace.project.settings.mainFileId);
if (!file) throw new Error("Main file missing");
const transport = createEditorTransport({ client: session.client, workspace });
const source = await transport.open(file);
const host = document.getElementById("root");
if (!host) throw new Error("Standalone mount missing");
let handle: AuthoringHandle | null = null;
let firstHandle: AuthoringHandle | null = null;
const navigation = {
  openFile: async () => {}, changeBranch: async () => {}, revealPdf: () => {},
  revealSource: async () => {},
};
// Capture this real client/actions object before tracking is enabled.
const guardedClient = sourceToolsClient(session.client, () => readDraft(draftKey(workspace, source), source).enabled);
const actions = createToolsActions({
  client: guardedClient, workspace, document: source, authoring: null, navigation,
  refreshWorkspace: async () => { if (route) await loadEditorWorkspace(session.client, route); },
});
function Standalone() {
  const [selection, setSelection] = useState<SourceSelection>({ anchor: 0, head: 0 });
  const [preferences, setPreferences] = useState(account?.preferences);
  if (!preferences) throw new Error("Preferences missing");
  return <SourcePanel client={session.client} workspace={workspace} document={source}
    preferences={preferences} onPreferencesChange={setPreferences} diagnostics={[]}
    selection={selection} onSelectionChange={setSelection} onHandle={value => {
      handle = value; if (value) { firstHandle ??= value; initialized.resolve(); }
    }}
    refreshWorkspace={async () => { if (route) await loadEditorWorkspace(session.client, route); }}
    navigation={{
      openFile: async () => {}, changeBranch: async () => {}, revealPdf: () => {},
      revealSource: location => Promise.resolve(handle?.reveal(location)),
    }} />;
}
const root = createRoot(host);
root.render(<Standalone />);
export function insert(text: string) { handle?.replaceSelection(text); }
export async function blockedMutations() {
  const results: { operation: string; code: string }[] = [];
  const attempt = async (operation: string, action: () => Promise<unknown>) => {
    try { await action(); results.push({ operation, code: "UNEXPECTED_SUCCESS" }); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      results.push({ operation, code: error instanceof EditorApiError ? error.code : error.name });
    }
  };
  const bibliography = workspace.files.find(entry => entry.path === "refs.bib");
  if (!bibliography) throw new Error("Seeded bibliography missing");
  await attempt("citation-copy", () => actions.citation({
    provider: "local", providerId: "p31-blocked", title: "Blocked citation",
    authors: [], year: null, doi: null, url: null,
    bibtex: "@article{P31Blocked,title={Must not reach project source}}",
  }, bibliography.id));
  await attempt("upload", () => actions.upload([new File(["blocked bytes"], "p31-blocked.txt")]));
  await attempt("file-create", () => actions.create({ path: "p31-blocked.tex", kind: "file", text: "blocked source" }));
  await attempt("link", () => actions.link({ path: "p31-linked.tex", kind: "project",
    sourceProjectId: workspace.scope.projectId, sourceFileId: source.file.id }));
  await attempt("metadata-mutation", () => guardedClient.callWithMetadata(
    endpoints.filePatch,
    { params: { p: workspace.scope.projectId, f: source.file.id }, query: {},
      body: { scope: workspace.scope, path: "p31-renamed.tex", expectedVersion: workspace.access.branchRevision } },
  ));
  await attempt("stale-handle-package", () => insertCommand({
    client: guardedClient, workspace, document: source, authoring: firstHandle, navigation,
    refreshWorkspace: async () => {},
  }, { packageName: "p31blocked", command: "\\p31blocked{}" }));
  return { results, sourceReadOnly: source.getSnapshot().readOnly, source: source.source.toJSON() };
}
export function binding() {
  const node = document.querySelector<HTMLElement>(".cm-content");
  const view = node && EditorView.findFromDOM(node);
  if (!view) throw new Error("Editor view missing");
  const bound = view.state.facet(ySyncFacet).ytext;
  return { shared: bound === source.source, source: source.source.toJSON(), draft: view.state.doc.toString() };
}
export async function close() { root.unmount(); await transport.dispose(); }
