import { assertNever } from "@quire/contracts";
import type { FileEntry, Id } from "@quire/contracts";
import type {
  EditorLayout, EditorPanel, EditorWorkspace, EffectiveAccess, PersistenceStatus, SourceSelection,
} from "./contracts";

export type WorkspaceState = {
  readonly workspace: EditorWorkspace;
  readonly selectedFileId: Id | null;
  readonly selection: SourceSelection;
  readonly layout: EditorLayout;
  readonly panel: EditorPanel;
};
export type WorkspaceAction =
  | { readonly type: "workspace"; readonly workspace: EditorWorkspace }
  | { readonly type: "file"; readonly fileId: Id }
  | { readonly type: "selection"; readonly selection: SourceSelection }
  | { readonly type: "layout"; readonly layout: EditorLayout }
  | { readonly type: "panel"; readonly panel: EditorPanel };
const start: SourceSelection = Object.freeze({ anchor: 0, head: 0 });
function initialFile(workspace: EditorWorkspace): Id | null {
  return workspace.files.find(file => file.id === workspace.project.settings.mainFileId && file.kind === "file")?.id
    ?? workspace.files.find(file => file.kind === "file")?.id ?? null;
}
export function initialWorkspaceState(workspace: EditorWorkspace, layout: EditorLayout = "split"): WorkspaceState {
  return { workspace, selectedFileId: initialFile(workspace), selection: start, layout, panel: "files" };
}
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "workspace": {
      const sameScope = state.workspace.scope.projectId === action.workspace.scope.projectId
        && state.workspace.scope.branch === action.workspace.scope.branch;
      const selected = sameScope && action.workspace.files.some(file => file.id === state.selectedFileId && file.kind === "file")
        ? state.selectedFileId : initialFile(action.workspace);
      const oldFile = state.workspace.files.find(file => file.id === state.selectedFileId);
      const newFile = action.workspace.files.find(file => file.id === selected);
      const keepSelection = sameScope && selected === state.selectedFileId && oldFile?.version.epoch === newFile?.version.epoch;
      return { ...state, workspace: action.workspace, selectedFileId: selected,
        selection: keepSelection ? state.selection : start };
    }
    case "file":
      if (!state.workspace.files.some(file => file.id === action.fileId && file.kind === "file")) return state;
      return action.fileId === state.selectedFileId ? state : { ...state, selectedFileId: action.fileId, selection: start };
    case "selection": return { ...state, selection: action.selection };
    case "layout": return { ...state, layout: action.layout };
    case "panel": return { ...state, panel: action.panel };
    default: return assertNever(action);
  }
}
/** React can consume this with useSyncExternalStore; it holds no source text or Y.Doc. */
export function createWorkspaceStore(initial: WorkspaceState) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispatch(action: WorkspaceAction) {
      const next = workspaceReducer(snapshot, action);
      if (next === snapshot) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}
export function readOnlyReason(access: EffectiveAccess, file: FileEntry, persistence: PersistenceStatus): string | null {
  if (!access.capabilities.edit) return access.capabilities.join ? "Join the project to edit" : "Project access is read-only";
  if (!file.editable) return "This file is not editable text";
  if (file.link) return "Linked source is read-only";
  switch (persistence.kind) {
    case "connecting": return "Connecting to the document";
    case "closed": return persistence.reason;
    case "recovery": return persistence.message;
    case "offline": return persistence.editable ? null : "Offline editing window expired; export recovery text";
    case "saved":
    case "saving": return null;
    default: return assertNever(persistence);
  }
}
