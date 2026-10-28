import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { endpoints } from "@quire/contracts";
import type { FileEntry, Preferences } from "@quire/contracts";
import { createSession } from "../../../apps/web/src/session";
import { editorValue, loadEditorWorkspace, parseEditorRoute } from "../../../apps/web/src/features/editor/shared";
import type { EditorDocument, EditorWorkspace, AuthoringHandle, EditorNavigation } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import { ToolsPanel } from "../../../apps/web/src/features/editor/tools";
import type { FilesPanelProps } from "../../../apps/web/src/features/editor/tools";
import "../../../apps/web/src/styles/tokens.css";
import "../../../apps/web/src/styles/global.css";
import "./harness.css";

const emptySubscribe = () => () => {};
const emptySnapshot = () => null;
export async function mountTools(projectId: string, filesPresentation: NonNullable<FilesPanelProps["presentation"]> = "standalone") {
  const session = createSession();
  await session.refresh();
  const parsedRoute = parseEditorRoute(`/projects/${projectId}/edit`);
  if (!parsedRoute) throw new TypeError("Invalid project route");
  const route = parsedRoute;
  const initial = await loadEditorWorkspace(session.client, route);
  const transport = createEditorTransport({ client: session.client, workspace: initial });
  const container = document.createElement("div");
  container.id = "tools-test-root";
  document.body.replaceChildren(container);
  const root = createRoot(container);
  const start = initial.files.find(file => file.id === initial.project.settings.mainFileId);
  if (!start) throw new TypeError("Main file missing");
  const initialDocument = await transport.open(start);
  await initialDocument.flush(AbortSignal.timeout(30_000));
  function Harness() {
    const [workspace, setWorkspace] = useState<EditorWorkspace>(initial);
    const [active, setActive] = useState<EditorDocument>(initialDocument);
    const [preferences, setPreferences] = useState<Preferences | null>(null);
    const [selection, setSelection] = useState({ anchor: 0, head: 0 });
    const [readOnlyText, setReadOnlyText] = useState<string | null>(null);
    const [readOnlyFile, setReadOnlyFile] = useState<FileEntry | null>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const snapshot = useSyncExternalStore(active?.subscribe ?? emptySubscribe, active?.getSnapshot ?? emptySnapshot);
    const [text, setText] = useState(active.source.toJSON());
    useEffect(() => {
      const changed = () => setText(active.source.toJSON());
      active.source.observe(changed); changed();
      return () => active.source.unobserve(changed);
    }, [active]);
    const refreshWorkspace = async () => setWorkspace(await loadEditorWorkspace(session.client, route));
    const open = async (file: FileEntry) => {
      await active.flush();
      if (!file.editable) {
        const loaded = editorValue(await session.client.call(endpoints.fileContent, {
          params: { p: workspace.project.id, f: file.id }, query: { branch: workspace.scope.branch }, body: undefined,
          headers: workspace.requestHeaders,
        }));
        setReadOnlyText(new TextDecoder("utf-8", { fatal: true }).decode(loaded));
        setReadOnlyFile(file);
        return;
      }
      setReadOnlyText(null); setReadOnlyFile(null); setActive(await transport.open(file));
    };
    const navigation: EditorNavigation = {
      openFile: async id => {
        const file = workspace.files.find(item => item.id === id);
        if (!file) throw new TypeError("File missing"); await open(file);
      },
      revealSource: async location => {
        const file = workspace.files.find(item => item.id === location.fileId);
        if (!file) throw new TypeError("Search file missing");
        await open(file);
        window.dispatchEvent(new CustomEvent("tools:navigation", { detail: location }));
      },
      revealPdf: location => window.dispatchEvent(new CustomEvent("tools:pdf-navigation", { detail: location })),
      changeBranch: async () => { throw new TypeError("This tools-only harness does not assemble branch navigation."); },
    };
    const authoring: AuthoringHandle = {
      focus: () => input.current?.focus(),
      select: value => { setSelection(value); input.current?.setSelectionRange(value.anchor, value.head); },
      reveal: location => window.dispatchEvent(new CustomEvent("tools:navigation", { detail: location })),
      replaceSelection: insert => {
        const from = Math.min(selection.anchor, selection.head);
        const to = Math.max(selection.anchor, selection.head);
        active.replace([{ from, to, insert }]);
        setSelection({ anchor: from + insert.length, head: from + insert.length });
      },
    };
    return <main className="tools-harness" data-document-id={readOnlyFile?.id ?? active.file.id} data-persistence={snapshot?.persistence.kind}
      data-document-state={JSON.stringify(snapshot?.persistence)}>
      <ToolsPanel filesPresentation={filesPresentation} client={session.client} workspace={workspace} document={active} authoring={readOnlyText === null ? authoring : null}
        navigation={navigation} refreshWorkspace={refreshWorkspace} onPreferencesChange={setPreferences}
        onSessionChange={async () => { await session.refresh(); }} />
      <section aria-label="Source test region">
        <h1>{workspace.files.find(file => file.id === (readOnlyFile?.id ?? active.file.id))?.path ?? "Removed file"}</h1><p role="status">{snapshot?.persistence.kind}</p>
        <textarea aria-label="Source test consumer" ref={input} value={readOnlyText ?? text}
          readOnly={readOnlyText !== null || snapshot?.readOnly}
          onSelect={event => setSelection({ anchor: event.currentTarget.selectionStart, head: event.currentTarget.selectionEnd })}
          onChange={event => active.replace([{ from: 0, to: active.source.length, insert: event.target.value }])} />
        <output aria-label="Applied preferences">{preferences ? `${preferences.theme}/${preferences.dictionary}/${preferences.spellCheck}` : "unchanged"}</output>
      </section>
    </main>;
  }
  root.render(<Harness />);
  const cleanup = async () => { root.unmount(); await transport.dispose(); };
  window.addEventListener("tools:dispose", () => { void cleanup().then(() => window.dispatchEvent(new Event("tools:disposed"))); }, { once: true });
}
