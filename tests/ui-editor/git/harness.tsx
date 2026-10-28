import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { createSession } from "../../../apps/web/src/session";
import { GitPanel } from "../../../apps/web/src/features/editor/git";
import {
  loadEditorWorkspace, parseEditorRoute,
} from "../../../apps/web/src/features/editor/shared";
import type {
  EditorNavigation, EditorWorkspace,
} from "../../../apps/web/src/features/editor/shared";

function Harness({ initial, session }: {
  readonly initial: EditorWorkspace;
  readonly session: ReturnType<typeof createSession>;
}) {
  const [workspace, setWorkspace] = useState(initial);
  const load = useCallback(async (branch: string) => {
    const route = parseEditorRoute(`/projects/${workspace.project.id}/git?branch=${encodeURIComponent(branch)}`);
    if (!route) throw new TypeError("Git harness route is invalid");
    const next = await loadEditorWorkspace(session.client, route);
    setWorkspace(next);
  }, [session.client, workspace.project.id]);
  const navigation: EditorNavigation = {
    openFile: async () => {},
    revealSource: async () => {},
    revealPdf: () => {},
    changeBranch: load,
  };
  return <div className="git-test-shell" data-testid="git-harness-ready">
    <GitPanel client={session.client} workspace={workspace} document={null}
      navigation={navigation} refreshWorkspace={() => load(workspace.scope.branch)} />
  </div>;
}

export async function mountGitHarness(): Promise<void> {
  const url = new URL(location.href);
  const projectId = url.searchParams.get("gitProject");
  const branch = url.searchParams.get("gitBranch") ?? "main";
  if (!projectId) throw new TypeError("gitProject query parameter is required");
  const route = parseEditorRoute(`/projects/${projectId}/git?branch=${encodeURIComponent(branch)}`);
  if (!route) throw new TypeError("Git harness route is invalid");
  const session = createSession();
  if (!await session.refresh()) throw new TypeError("Authenticated session required");
  const workspace = await loadEditorWorkspace(session.client, route);
  document.body.innerHTML = '<div id="git-test-root"></div>';
  const root = document.getElementById("git-test-root");
  if (!root) throw new TypeError("Git harness root missing");
  createRoot(root).render(<Harness initial={workspace} session={session} />);
}
