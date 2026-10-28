import { describe, expect, test } from "bun:test";
import { FileEntrySchema, ProjectSchema, endpoints } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import {
  createWorkspaceStore, initialWorkspaceState, parseEditorRoute, readOnlyReason, workspaceReducer,
} from "../../../apps/web/src/features/editor/shared";
import type { EditorWorkspace, PersistenceStatus } from "../../../apps/web/src/features/editor/shared";

const file = FileEntrySchema.parse({
  id: fixtureIds.mainFile, path: "main.tex", kind: "file", mime: "text/x-tex",
  blob: null, bytes: 0, editable: true, version: { revision: 0, epoch: 0 }, link: null,
});
const project = ProjectSchema.parse({
  id: fixtureIds.project, name: "State fixture", ownerId: fixtureIds.kien, workspaceId: null,
  defaultBranch: "main", version: 0, createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z",
  settings: { engine: "pdflatex", mainFileId: file.id, environmentId: fixtureIds.environment,
    draft: false, stopOnFirstError: false },
});
const access = endpoints.projectAccess.output.parse({
  actorId: fixtureIds.kien, role: "owner", source: "owner", branchRevision: 7,
  capabilities: { read: true, edit: true, compile: true, review: true, chat: true, manageAccess: true, join: false },
});
const workspace: EditorWorkspace = {
  scope: { projectId: project.id, branch: "main" }, project, access, files: [file], requestHeaders: {},
};

describe("shared workspace", () => {
  test("resets source selection when the branch changes", () => {
    // Given a cursor in the same file identity on main.
    const state = { ...initialWorkspaceState(workspace), selection: { anchor: 12, head: 15 } };
    // When another branch with the same file IDs is loaded.
    const next = workspaceReducer(state, { type: "workspace",
      workspace: { ...workspace, scope: { ...workspace.scope, branch: "draft" } } });
    // Then offsets are not carried into unrelated branch text.
    expect(next.selection).toEqual({ anchor: 0, head: 0 });
  });
  test("resets selection when a restore changes the document epoch", () => {
    // Given a selected interval before restore.
    const state = { ...initialWorkspaceState(workspace), selection: { anchor: 2, head: 4 } };
    // When the same file is replaced by a new epoch.
    const next = workspaceReducer(state, { type: "workspace", workspace: {
      ...workspace, files: [{ ...file, version: { revision: 8, epoch: 1 } }],
    } });
    // Then stale offsets cannot select different restored text.
    expect(next.selection).toEqual({ anchor: 0, head: 0 });
  });
  test("keeps selection when only server revision changes", () => {
    // Given a selected interval in the live document.
    const selection = { anchor: 2, head: 4 };
    const state = { ...initialWorkspaceState(workspace), selection };
    // When workspace metadata refreshes after an acknowledgment.
    const next = workspaceReducer(state, { type: "workspace", workspace: {
      ...workspace, files: [{ ...file, version: { revision: 8, epoch: 0 } }],
    } });
    // Then transport/CodeMirror, not metadata refresh, owns cursor mapping.
    expect(next.selection).toBe(selection);
  });
  test("selects no file when the last source is deleted", () => {
    // Given a selected source.
    const state = initialWorkspaceState(workspace);
    // When the tree is emptied.
    const next = workspaceReducer(state, { type: "workspace", workspace: { ...workspace, files: [] } });
    // Then no stale file ID survives.
    expect(next.selectedFileId).toBeNull();
  });
  test("notifies subscribers when a valid workspace transition occurs", () => {
    // Given a store observed before dispatch.
    const store = createWorkspaceStore(initialWorkspaceState(workspace));
    const changes: string[] = [];
    const unsubscribe = store.subscribe(() => changes.push(store.getSnapshot().layout));
    // When the layout changes.
    store.dispatch({ type: "layout", layout: "stacked" });
    // Then the observer reads the new stable snapshot.
    expect(changes).toEqual(["stacked"]);
    unsubscribe();
  });
  test("does not notify for a missing file selection", () => {
    // Given a store with no matching target.
    const store = createWorkspaceStore(initialWorkspaceState(workspace));
    let calls = 0;
    const unsubscribe = store.subscribe(() => { calls++; });
    // When a stale tree selection is dispatched.
    store.dispatch({ type: "file", fileId: fixtureIds.outsider });
    // Then neither state nor observers move.
    expect(calls).toBe(0);
    expect(store.getSnapshot().selectedFileId).toBe(file.id);
    unsubscribe();
  });
});

describe("read-only status", () => {
  test("uses effective capability rather than an editor link role", () => {
    // Given an anonymous editor-link reader who cannot join or edit.
    const reader = { ...access, actorId: null, role: "editor" as const, source: "link" as const,
      capabilities: { ...access.capabilities, edit: false, join: false } };
    // When the authoring status is derived.
    const reason = readOnlyReason(reader, file, { kind: "saved", revision: 0 });
    // Then a nominal editor role cannot enable mutation.
    expect(reason).not.toBeNull();
  });
  test.each([
    { kind: "connecting" },
    { kind: "offline", pendingUpdates: 1, editable: false, since: 0 },
    { kind: "recovery", code: "EPOCH_CHANGED", message: "Recover", localText: "local", serverText: "remote" },
    { kind: "closed", reason: "Access revoked" },
  ] satisfies readonly PersistenceStatus[])("locks source for $kind transport state", persistence => {
    // Given editable source and an owner, when transport requires a lock.
    const reason = readOnlyReason(access, file, persistence);
    // Then authoring is read-only.
    expect(reason).not.toBeNull();
  });
  test("allows a bounded offline local edit without declaring it saved", () => {
    // Given an editable offline window with unacknowledged work.
    const persistence: PersistenceStatus = { kind: "offline", pendingUpdates: 2, editable: true, since: 0 };
    // When read-only status is derived.
    const reason = readOnlyReason(access, file, persistence);
    // Then local authoring remains available while persistence remains offline.
    expect(reason).toBeNull();
  });
  test("locks linked files even for owners", () => {
    // Given a read-only linked source.
    const linked = { ...file, link: { kind: "project" as const, sourceId: project.id, lastRefreshedAt: null } };
    // When the source capability is derived.
    const reason = readOnlyReason(access, linked, { kind: "saved", revision: 0 });
    // Then editing is unavailable.
    expect(reason).not.toBeNull();
  });
});

describe("editor routes", () => {
  test("preserves branch and share scope when parsing navigation", () => {
    // Given a review route with a branch and share grant.
    const path = `/projects/${project.id}/review?branch=feature%2Fpaper&share=secret`;
    // When parsed at the browser route boundary.
    const route = parseEditorRoute(path);
    // Then the explicit scope and credential remain available to the injected client.
    expect(route).toEqual({ projectId: project.id, branch: "feature/paper", page: "review", shareToken: "secret" });
  });
  test.each(["/projects/not-an-id/edit", `/projects/${project.id}/edit?branch=../other`, "/projects"])(
    "rejects invalid editor input %s", path => {
      // Given untrusted navigation, when parsed.
      const route = parseEditorRoute(path);
      // Then no invalid scope reaches service calls.
      expect(route).toBeNull();
    },
  );
});
